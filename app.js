const API = "https://public.api.bsky.app/xrpc";

const DAYS_TO_ANALYZE = 7;
const MAX_CONTACTS = 28;
const MIN_INTERACTIONS = 1;
const POST_CONCURRENCY = 8;

const SCORE = {
  like: 1,
  repost: 3,
  reply: 5,
  quote: 5
};

const CARD_THEMES = {
  yellow: {
    name: "Yellow",
    background: "#17200b",
    glow1: "#facc15",
    glow2: "#fde68a",
    text: "#ffffff",
    muted: "#fff4b8",
    swatch: "#facc15"
  },

  green: {
    name: "Green",
    background: "#071c13",
    glow1: "#22c55e",
    glow2: "#86efac",
    text: "#ffffff",
    muted: "#b8f5ca",
    swatch: "#22c55e"
  },

  blue: {
    name: "Blue",
    background: "#06182c",
    glow1: "#1185fe",
    glow2: "#67d8ff",
    text: "#ffffff",
    muted: "#b5ddff",
    swatch: "#1185fe"
  },

  red: {
    name: "Red",
    background: "#240d12",
    glow1: "#ef4444",
    glow2: "#fb7185",
    text: "#ffffff",
    muted: "#ffc1c9",
    swatch: "#ef4444"
  },
  
  purple: {
  name: "Purple",

  pageBg: "#160b1f",
  pageGlow1: "#a855f7",
  pageGlow2: "#d8b4fe",

  background: "#1b0d29",
  glow1: "#a855f7",
  glow2: "#d8b4fe",

  text: "#ffffff",
  muted: "#e9d5ff",

  accent: "#a855f7",
  accentLight: "#d8b4fe",

  glassBg: "rgba(255,255,255,0.075)",
  glassBorder: "rgba(255,255,255,0.14)",

  inputBg: "rgba(18,5,30,0.55)",

  swatch: "#a855f7"
},

  white: {
    name: "White",
    background: "#17202b",
    glow1: "#ffffff",
    glow2: "#dbeafe",
    text: "#ffffff",
    muted: "#dbe7f2",
    swatch: "#ffffff"
  }
};

let selectedTheme = "blue";


function setProgress(percent) {
  const generateBtn =
    document.getElementById("generateBtn");

  const status =
    document.getElementById("status");

  const value =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(percent)
      )
    );

  if (status) {
    status.innerText = "";
  }

  if (generateBtn) {
    generateBtn.innerText =
      `${value}%`;
  }
}


async function apiGet(
  endpoint,
  params = {},
  base = API
) {
  const query =
    new URLSearchParams();

  for (
    const [key, value]
    of Object.entries(params)
  ) {
    if (
      value !== undefined &&
      value !== null
    ) {
      query.set(
        key,
        value
      );
    }
  }

  const response =
    await fetch(
      `${base}/${endpoint}?${query.toString()}`
    );

  if (!response.ok) {
    let message =
      `API error ${endpoint} (${response.status})`;

    try {
      const data =
        await response.json();

      if (data.message) {
        message +=
          `: ${data.message}`;
      }
    } catch (_) {}

    throw new Error(message);
  }

  return response.json();
}


function getSinceDate() {
  const date =
    new Date();

  date.setDate(
    date.getDate() -
    DAYS_TO_ANALYZE
  );

  return date;
}


async function resolveHandle(handle) {
  const data =
    await apiGet(
      "com.atproto.identity.resolveHandle",
      {
        handle
      }
    );

  if (!data.did) {
    throw new Error(
      "Unable to resolve this Bluesky handle."
    );
  }

  return data.did;
}


async function getProfile(did) {
  return apiGet(
    "app.bsky.actor.getProfile",
    {
      actor: did
    }
  );
}


async function getPdsEndpoint(did) {
  let didDocument;

  if (
    did.startsWith("did:plc:")
  ) {
    const response =
      await fetch(
        `https://plc.directory/${did}`
      );

    if (!response.ok) {
      throw new Error(
        "Unable to retrieve DID document."
      );
    }

    didDocument =
      await response.json();

  } else if (
    did.startsWith("did:web:")
  ) {
    const domain =
      did.substring(
        "did:web:".length
      );

    const response =
      await fetch(
        `https://${domain}/.well-known/did.json`
      );

    if (!response.ok) {
      throw new Error(
        "Unable to retrieve DID document."
      );
    }

    didDocument =
      await response.json();

  } else {
    throw new Error(
      `Unsupported DID type: ${did}`
    );
  }

  const service =
    didDocument.service?.find(
      service =>
        service.id === "#atproto_pds"
    );

  if (
    !service ||
    !service.serviceEndpoint
  ) {
    throw new Error(
      "Unable to find the account PDS."
    );
  }

  return (
    service.serviceEndpoint
      .replace(/\/$/, "") +
    "/xrpc"
  );
}


async function getAllFollows(
  myDid,
  progressStart = 5,
  progressEnd = 15
) {
  const follows =
    new Set();

  let cursor = null;
  let pages = 0;

  while (true) {
    const params = {
      actor: myDid,
      limit: 100
    };

    if (cursor) {
      params.cursor =
        cursor;
    }

    const data =
      await apiGet(
        "app.bsky.graph.getFollows",
        params
      );

    for (
      const profile
      of data.follows || []
    ) {
      if (profile.did) {
        follows.add(
          profile.did
        );
      }
    }

    pages++;

    setProgress(
      Math.min(
        progressEnd,
        progressStart +
        pages * 2
      )
    );

    if (!data.cursor) {
      break;
    }

    cursor =
      data.cursor;
  }

  return follows;
}


async function listRecords(
  pds,
  did,
  collection,
  sinceDate
) {
  const records =
    [];

  let cursor =
    null;

  while (true) {
    const params = {
      repo: did,
      collection,
      limit: 100,
      reverse: true
    };

    if (cursor) {
      params.cursor =
        cursor;
    }

    const data =
      await apiGet(
        "com.atproto.repo.listRecords",
        params,
        pds
      );

    if (
      !data.records ||
      data.records.length === 0
    ) {
      break;
    }

    let reachedOldRecords =
      false;

    for (
      const record
      of data.records
    ) {
      const createdAt =
        record.value?.createdAt
          ? new Date(
              record.value.createdAt
            )
          : null;

      if (
        createdAt &&
        createdAt < sinceDate
      ) {
        reachedOldRecords =
          true;

        break;
      }

      records.push(
        record
      );
    }

    if (
      reachedOldRecords ||
      !data.cursor
    ) {
      break;
    }

    cursor =
      data.cursor;
  }

  return records;
}


function ensureContact(
  contacts,
  actor,
  myDid,
  followedDids
) {
  if (
    !actor ||
    !actor.did ||
    actor.did === myDid
  ) {
    return null;
  }

  if (
    !followedDids.has(
      actor.did
    )
  ) {
    return null;
  }

  if (
    !contacts[actor.did]
  ) {
    contacts[actor.did] = {
      did: actor.did,

      handle:
        actor.handle || "",

      displayName:
        actor.displayName || "",

      avatar:
        actor.avatar || "",

      outgoingScore: 0,
      incomingScore: 0,

      outgoingCount: 0,
      incomingCount: 0,

      interactions: 0,

      score: 0
    };
  }

  if (actor.handle) {
    contacts[actor.did].handle =
      actor.handle;
  }

  if (actor.displayName) {
    contacts[actor.did].displayName =
      actor.displayName;
  }

  if (actor.avatar) {
    contacts[actor.did].avatar =
      actor.avatar;
  }

  return contacts[actor.did];
}


function addInteraction(
  contacts,
  actor,
  type,
  myDid,
  direction,
  followedDids
) {
  const contact =
    ensureContact(
      contacts,
      actor,
      myDid,
      followedDids
    );

  if (!contact) {
    return;
  }

  const points =
    SCORE[type];

  if (!points) {
    return;
  }

  if (
    direction === "outgoing"
  ) {
    contact.outgoingScore +=
      points;

    contact.outgoingCount++;
  } else {
    contact.incomingScore +=
      points;

    contact.incomingCount++;
  }

  contact.interactions++;
}


function calculateFinalScores(
  contacts
) {
  return Object.values(
    contacts
  )
    .filter(
      contact =>
        contact.interactions >=
        MIN_INTERACTIONS
    )
    .map(contact => {
      contact.score =
        contact.outgoingScore +
        contact.incomingScore;

      return contact;
    })
    .filter(
      contact =>
        contact.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      MAX_CONTACTS
    );
}


async function getPostsByUris(
  uris
) {
  const uniqueUris =
    [
      ...new Set(
        uris.filter(Boolean)
      )
    ];

  const posts =
    [];

  const BATCH_SIZE =
    25;

  for (
    let i = 0;
    i < uniqueUris.length;
    i += BATCH_SIZE
  ) {
    const batch =
      uniqueUris.slice(
        i,
        i + BATCH_SIZE
      );

    if (!batch.length) {
      continue;
    }

    const data =
      await apiGet(
        "app.bsky.feed.getPosts",
        {
          uris: batch
        }
      );

    if (data.posts) {
      posts.push(
        ...data.posts
      );
    }
  }

  return posts;
}


function getQuotedUriFromRecord(
  record
) {
  if (!record?.embed) {
    return null;
  }

  if (
    record.embed.record?.uri
  ) {
    return (
      record.embed.record.uri
    );
  }

  if (
    record.embed.record?.record?.uri
  ) {
    return (
      record.embed.record.record.uri
    );
  }

  return null;
}


async function analyzeOutgoingInteractions(
  pds,
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  setProgress(20);

  const [
    likeRecords,
    repostRecords,
    postRecords
  ] = await Promise.all([
    listRecords(
      pds,
      myDid,
      "app.bsky.feed.like",
      sinceDate
    ),

    listRecords(
      pds,
      myDid,
      "app.bsky.feed.repost",
      sinceDate
    ),

    listRecords(
      pds,
      myDid,
      "app.bsky.feed.post",
      sinceDate
    )
  ]);

  setProgress(30);

  const targetUris =
    [];

  for (
    const record
    of likeRecords
  ) {
    const uri =
      record.value?.subject?.uri;

    if (uri) {
      targetUris.push(
        uri
      );
    }
  }

  for (
    const record
    of repostRecords
  ) {
    const uri =
      record.value?.subject?.uri;

    if (uri) {
      targetUris.push(
        uri
      );
    }
  }

  for (
    const record
    of postRecords
  ) {
    const replyUri =
      record.value?.reply?.parent?.uri;

    if (replyUri) {
      targetUris.push(
        replyUri
      );
    }

    const quoteUri =
      getQuotedUriFromRecord(
        record.value
      );

    if (quoteUri) {
      targetUris.push(
        quoteUri
      );
    }
  }

  const targetPosts =
    await getPostsByUris(
      targetUris
    );

  const postsByUri =
    new Map();

  for (
    const post
    of targetPosts
  ) {
    postsByUri.set(
      post.uri,
      post
    );
  }

  for (
    const record
    of likeRecords
  ) {
    const uri =
      record.value?.subject?.uri;

    const post =
      postsByUri.get(
        uri
      );

    if (post?.author) {
      addInteraction(
        contacts,
        post.author,
        "like",
        myDid,
        "outgoing",
        followedDids
      );
    }
  }

  for (
    const record
    of repostRecords
  ) {
    const uri =
      record.value?.subject?.uri;

    const post =
      postsByUri.get(
        uri
      );

    if (post?.author) {
      addInteraction(
        contacts,
        post.author,
        "repost",
        myDid,
        "outgoing",
        followedDids
      );
    }
  }

  for (
    const record
    of postRecords
  ) {
    const parentUri =
      record.value?.reply?.parent?.uri;

    if (!parentUri) {
      continue;
    }

    const parentPost =
      postsByUri.get(
        parentUri
      );

    if (parentPost?.author) {
      addInteraction(
        contacts,
        parentPost.author,
        "reply",
        myDid,
        "outgoing",
        followedDids
      );
    }
  }

  for (
    const record
    of postRecords
  ) {
    const quotedUri =
      getQuotedUriFromRecord(
        record.value
      );

    if (!quotedUri) {
      continue;
    }

    const quotedPost =
      postsByUri.get(
        quotedUri
      );

    if (quotedPost?.author) {
      addInteraction(
        contacts,
        quotedPost.author,
        "quote",
        myDid,
        "outgoing",
        followedDids
      );
    }
  }

  setProgress(40);
}


async function getRecentOwnPosts(
  myDid,
  sinceDate
) {
  const posts =
    [];

  let cursor =
    null;

  while (true) {
    const params = {
      actor: myDid,
      limit: 100
    };

    if (cursor) {
      params.cursor =
        cursor;
    }

    const data =
      await apiGet(
        "app.bsky.feed.getAuthorFeed",
        params
      );

    if (
      !data.feed ||
      data.feed.length === 0
    ) {
      break;
    }

    let reachedOldPosts =
      false;

    for (
      const item
      of data.feed
    ) {
      const post =
        item.post;

      if (!post) {
        continue;
      }

      if (
        post.author?.did !==
        myDid
      ) {
        continue;
      }

      const date =
        new Date(
          post.record?.createdAt ||
          post.indexedAt
        );

      if (date < sinceDate) {
        reachedOldPosts =
          true;

        break;
      }

      posts.push(
        post
      );
    }

    if (
      reachedOldPosts ||
      !data.cursor
    ) {
      break;
    }

    cursor =
      data.cursor;
  }

  return posts;
}


async function processInBatches(
  items,
  concurrency,
  callback,
  onProgress
) {
  let nextIndex =
    0;

  let completed =
    0;

  async function worker() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >= items.length
      ) {
        return;
      }

      try {
        await callback(
          items[index]
        );
      } catch (error) {
        console.warn(
          "Post analysis failed:",
          error
        );
      }

      completed++;

      if (onProgress) {
        onProgress(
          completed,
          items.length
        );
      }
    }
  }

  const workers =
    [];

  const workerCount =
    Math.min(
      concurrency,
      items.length
    );

  for (
    let i = 0;
    i < workerCount;
    i++
  ) {
    workers.push(
      worker()
    );
  }

  await Promise.all(
    workers
  );
}


async function analyzeIncomingInteractions(
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  const ownPosts =
    await getRecentOwnPosts(
      myDid,
      sinceDate
    );

  if (!ownPosts.length) {
    setProgress(95);
    return;
  }

  await processInBatches(
    ownPosts,
    POST_CONCURRENCY,
    post =>
      analyzePostInteractions(
        post,
        myDid,
        sinceDate,
        contacts,
        followedDids
      ),
    (completed, total) => {
      const progress =
        40 +
        (
          completed / total
        ) * 55;

      setProgress(
        progress
      );
    }
  );

  setProgress(95);
}


async function analyzePostInteractions(
  post,
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  await Promise.all([
    analyzeLikes(
      post,
      myDid,
      sinceDate,
      contacts,
      followedDids
    ),

    analyzeReposts(
      post,
      myDid,
      sinceDate,
      contacts,
      followedDids
    ),

    analyzeQuotes(
      post,
      myDid,
      sinceDate,
      contacts,
      followedDids
    ),

    analyzeReplies(
      post,
      myDid,
      sinceDate,
      contacts,
      followedDids
    )
  ]);
}


async function analyzeLikes(
  post,
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  let cursor =
    null;

  while (true) {
    const params = {
      uri: post.uri,
      cid: post.cid,
      limit: 100
    };

    if (cursor) {
      params.cursor =
        cursor;
    }

    const data =
      await apiGet(
        "app.bsky.feed.getLikes",
        params
      );

    for (
      const like
      of data.likes || []
    ) {
      const date =
        new Date(
          like.indexedAt
        );

      if (
        date < sinceDate
      ) {
        return;
      }

      if (like.actor) {
        addInteraction(
          contacts,
          like.actor,
          "like",
          myDid,
          "incoming",
          followedDids
        );
      }
    }

    if (!data.cursor) {
      break;
    }

    cursor =
      data.cursor;
  }
}


async function analyzeReposts(
  post,
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  let cursor =
    null;

  while (true) {
    const params = {
      uri: post.uri,
      cid: post.cid,
      limit: 100
    };

    if (cursor) {
      params.cursor =
        cursor;
    }

    const data =
      await apiGet(
        "app.bsky.feed.getRepostedBy",
        params
      );

    for (
      const actor
      of data.repostedBy || []
    ) {
      if (actor) {
        addInteraction(
          contacts,
          actor,
          "repost",
          myDid,
          "incoming",
          followedDids
        );
      }
    }

    if (!data.cursor) {
      break;
    }

    cursor =
      data.cursor;
  }
}


async function analyzeQuotes(
  post,
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  let cursor =
    null;

  while (true) {
    const params = {
      uri: post.uri,
      cid: post.cid,
      limit: 100
    };

    if (cursor) {
      params.cursor =
        cursor;
    }

    const data =
      await apiGet(
        "app.bsky.feed.getQuotes",
        params
      );

    for (
      const quotedPost
      of data.posts || []
    ) {
      const date =
        new Date(
          quotedPost.record?.createdAt ||
          quotedPost.indexedAt
        );

      if (
        date < sinceDate
      ) {
        return;
      }

      if (
        quotedPost.author
      ) {
        addInteraction(
          contacts,
          quotedPost.author,
          "quote",
          myDid,
          "incoming",
          followedDids
        );
      }
    }

    if (!data.cursor) {
      break;
    }

    cursor =
      data.cursor;
  }
}


async function analyzeReplies(
  post,
  myDid,
  sinceDate,
  contacts,
  followedDids
) {
  const data =
    await apiGet(
      "app.bsky.feed.getPostThread",
      {
        uri: post.uri,
        depth: 1,
        parentHeight: 0
      }
    );

  const replies =
    data.thread?.replies || [];

  for (
    const reply
    of replies
  ) {
    if (!reply?.post) {
      continue;
    }

    const replyPost =
      reply.post;

    const date =
      new Date(
        replyPost.record?.createdAt ||
        replyPost.indexedAt
      );

    if (
      date < sinceDate
    ) {
      continue;
    }

    const parentUri =
      replyPost.record?.reply?.parent?.uri;

    if (
      parentUri === post.uri &&
      replyPost.author
    ) {
      addInteraction(
        contacts,
        replyPost.author,
        "reply",
        myDid,
        "incoming",
        followedDids
      );
    }
  }
}


function createFallbackAvatar() {
  const svg =
    `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#17202b"/>
      <circle cx="100" cy="75" r="38" fill="#71859b"/>
      <path d="M35 180c8-42 33-62 65-62s57 20 65 62" fill="#71859b"/>
    </svg>
    `;

  return (
    "data:image/svg+xml;base64," +
    btoa(svg)
  );
}


async function fetchImageAsBase64(
  url
) {
  const fallback =
    createFallbackAvatar();

  if (!url) {
    return fallback;
  }

  try {
    const proxyUrl =
      `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp`;

    const response =
      await fetch(
        proxyUrl
      );

    if (!response.ok) {
      return fallback;
    }

    const blob =
      await response.blob();

    return new Promise(
      resolve => {
        const reader =
          new FileReader();

        reader.onloadend =
          () => {
            if (
              typeof reader.result ===
              "string"
            ) {
              resolve(
                reader.result
              );
            } else {
              resolve(
                fallback
              );
            }
          };

        reader.onerror =
          () => {
            resolve(
              fallback
            );
          };

        reader.readAsDataURL(
          blob
        );
      }
    );

  } catch (_) {
    return fallback;
  }
}


function getBlueskyProfileUrl(
  handle
) {
  if (!handle) {
    return "https://bsky.app";
  }

  return (
    "https://bsky.app/profile/" +
    encodeURIComponent(
      handle
    )
  );
}


function createThemePicker() {
  const downloadBtn =
    document.getElementById(
      "downloadBtn"
    );

  if (!downloadBtn) {
    return;
  }

  const oldPicker =
    document.getElementById(
      "themePicker"
    );

  if (oldPicker) {
    oldPicker.remove();
  }

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.id =
    "themePicker";

  wrapper.style.display =
    "none";

  wrapper.style.marginTop =
    "14px";

  wrapper.style.justifyContent =
    "center";

  wrapper.style.alignItems =
    "center";

  wrapper.style.gap =
    "12px";

  for (
    const [key, theme]
    of Object.entries(
      CARD_THEMES
    )
  ) {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.title =
      theme.name;

    button.setAttribute(
      "aria-label",
      theme.name
    );

    button.style.width =
      "30px";

    button.style.height =
      "30px";

    button.style.minWidth =
      "30px";

    button.style.padding =
      "0";

    button.style.margin =
      "0";

    button.style.borderRadius =
      "50%";

    button.style.cursor =
      "pointer";

    button.style.background =
      theme.swatch;

    button.style.boxShadow =
      key === selectedTheme
        ? (
            "0 0 0 3px #ffffff, " +
            "0 0 0 5px rgba(17,133,254,0.65)"
          )
        : (
            "0 1px 5px rgba(0,0,0,0.25)"
          );

    button.style.border =
      key === "white"
        ? "1px solid #cbd5e1"
        : "1px solid rgba(255,255,255,0.25)";

    button.addEventListener(
      "click",
      () => {
        selectedTheme =
          key;

        createThemePicker();

        const picker =
          document.getElementById(
            "themePicker"
          );

        if (picker) {
          picker.style.display =
            "flex";
        }
      }
    );

    wrapper.appendChild(
      button
    );
  }

  downloadBtn.parentNode.insertBefore(
    wrapper,
    downloadBtn.nextSibling
  );
}


async function generateCircle() {
  const inputElement =
    document.getElementById(
      "handleInput"
    );

  const handleInput =
    inputElement
      ? inputElement.value.trim()
      : "";

  const status =
    document.getElementById(
      "status"
    );

  const poster =
    document.getElementById(
      "mosaicPoster"
    );

  const tilesContainer =
    document.getElementById(
      "tilesContainer"
    );

  const generateBtn =
    document.getElementById(
      "generateBtn"
    );

  const downloadBtn =
    document.getElementById(
      "downloadBtn"
    );

  if (!handleInput) {
    if (status) {
      status.innerText =
        "Enter a Bluesky handle.";
    }

    return;
  }

  if (
    !poster ||
    !tilesContainer ||
    !generateBtn
  ) {
    console.error(
      "Required page elements are missing."
    );

    return;
  }

  generateBtn.disabled =
    true;

  generateBtn.innerText =
    "0%";

  if (downloadBtn) {
    downloadBtn.style.display =
      "none";
  }

  poster.style.display =
    "none";

  tilesContainer.innerHTML =
    "";

  const oldPicker =
    document.getElementById(
      "themePicker"
    );

  if (oldPicker) {
    oldPicker.remove();
  }

  try {
    setProgress(2);

    const myDid =
      await resolveHandle(
        handleInput
      );

    setProgress(5);

    const [
      myProfile,
      followedDids
    ] = await Promise.all([
      getProfile(
        myDid
      ),

      getAllFollows(
        myDid,
        5,
        15
      )
    ]);

    setProgress(15);

    const pds =
      await getPdsEndpoint(
        myDid
      );

    const sinceDate =
      getSinceDate();

    const contacts =
      {};

    await analyzeOutgoingInteractions(
      pds,
      myDid,
      sinceDate,
      contacts,
      followedDids
    );

    await analyzeIncomingInteractions(
      myDid,
      sinceDate,
      contacts,
      followedDids
    );

    setProgress(96);

    const sortedContacts =
      calculateFinalScores(
        contacts
      );

    if (
      sortedContacts.length === 0
    ) {
      setProgress(100);

      if (status) {
        status.innerText =
          "No interactions found.";
      }

      return;
    }

    const contactsWithAvatars =
      await Promise.all(
        sortedContacts.map(
          async contact => ({
            ...contact,

            avatar:
              await fetchImageAsBase64(
                contact.avatar
              )
          })
        )
      );

    setProgress(98);

    poster.style.display =
      "block";

    tilesContainer.style.display =
      "block";

    await new Promise(
      resolve =>
        requestAnimationFrame(
          () => resolve()
        )
    );

    await new Promise(
      resolve =>
        requestAnimationFrame(
          () => resolve()
        )
    );

    const rect =
      tilesContainer.getBoundingClientRect();

    if (
      !rect.width ||
      !rect.height
    ) {
      throw new Error(
        "Unable to determine the mosaic size."
      );
    }

    await renderMosaic(
      myProfile,
      contactsWithAvatars
    );

    setProgress(100);

    if (downloadBtn) {
      downloadBtn.style.display =
        "inline-block";
    }

    createThemePicker();

    const picker =
      document.getElementById(
        "themePicker"
      );

    if (picker) {
      picker.style.display =
        "flex";
    }

  } catch (error) {
    console.error(
      "Circle error:",
      error
    );

    if (status) {
      status.innerText =
        "Error: " +
        error.message;
    }

    poster.style.display =
      "none";

  } finally {
    generateBtn.disabled =
      false;

    generateBtn.innerText =
      "Generate";
  }
}


async function renderMosaic(
  myProfile,
  contacts
) {
  const container =
    document.getElementById(
      "tilesContainer"
    );

  if (!container) {
    throw new Error(
      "Mosaic container not found."
    );
  }

  const rect =
    container.getBoundingClientRect();

  const containerWidth =
    rect.width;

  if (!containerWidth) {
    throw new Error(
      "Mosaic container has no width."
    );
  }

  const gridDim =
    10;

  const centerPos = {
    r: 3,
    c: 3,
    size: 4
  };

  const tier1Pos = [
    {
      r: 0,
      c: 0,
      size: 3
    },
    {
      r: 0,
      c: 7,
      size: 3
    },
    {
      r: 7,
      c: 0,
      size: 3
    },
    {
      r: 7,
      c: 7,
      size: 3
    }
  ];

  const tier2Pos = [
    {
      r: 1,
      c: 3,
      size: 2
    },
    {
      r: 1,
      c: 5,
      size: 2
    },
    {
      r: 3,
      c: 1,
      size: 2
    },
    {
      r: 5,
      c: 1,
      size: 2
    },
    {
      r: 3,
      c: 7,
      size: 2
    },
    {
      r: 5,
      c: 7,
      size: 2
    },
    {
      r: 7,
      c: 3,
      size: 2
    },
    {
      r: 7,
      c: 5,
      size: 2
    }
  ];

  const tier3Pos = [
    {
      r: 0,
      c: 3,
      size: 1
    },
    {
      r: 0,
      c: 4,
      size: 1
    },
    {
      r: 0,
      c: 5,
      size: 1
    },
    {
      r: 0,
      c: 6,
      size: 1
    },

    {
      r: 3,
      c: 0,
      size: 1
    },
    {
      r: 4,
      c: 0,
      size: 1
    },
    {
      r: 5,
      c: 0,
      size: 1
    },
    {
      r: 6,
      c: 0,
      size: 1
    },

    {
      r: 3,
      c: 9,
      size: 1
    },
    {
      r: 4,
      c: 9,
      size: 1
    },
    {
      r: 5,
      c: 9,
      size: 1
    },
    {
      r: 6,
      c: 9,
      size: 1
    },

    {
      r: 9,
      c: 3,
      size: 1
    },
    {
      r: 9,
      c: 4,
      size: 1
    },
    {
      r: 9,
      c: 5,
      size: 1
    },
    {
      r: 9,
      c: 6,
      size: 1
    }
  ];

  const mainAvatar =
    await fetchImageAsBase64(
      myProfile.avatar
    );

  createTile(
    container,
    mainAvatar,
    centerPos.r,
    centerPos.c,
    centerPos.size,
    true,
    gridDim,
    null
  );

  let contactIdx =
    0;

  for (
    const pos
    of tier1Pos
  ) {
    if (
      contactIdx >=
      contacts.length
    ) {
      break;
    }

    const contact =
      contacts[
        contactIdx
      ];

    createTile(
      container,
      contact.avatar,
      pos.r,
      pos.c,
      pos.size,
      false,
      gridDim,
      contact
    );

    contactIdx++;
  }

  for (
    const pos
    of tier2Pos
  ) {
    if (
      contactIdx >=
      contacts.length
    ) {
      break;
    }

    const contact =
      contacts[
        contactIdx
      ];

    createTile(
      container,
      contact.avatar,
      pos.r,
      pos.c,
      pos.size,
      false,
      gridDim,
      contact
    );

    contactIdx++;
  }

  for (
    const pos
    of tier3Pos
  ) {
    if (
      contactIdx >=
      contacts.length
    ) {
      break;
    }

    const contact =
      contacts[
        contactIdx
      ];

    createTile(
      container,
      contact.avatar,
      pos.r,
      pos.c,
      pos.size,
      false,
      gridDim,
      contact
    );

    contactIdx++;
  }
}


function createTile(
  container,
  imgSrc,
  r,
  c,
  size,
  isMain,
  gridDim,
  contact
) {
  const rect =
    container.getBoundingClientRect();

  const containerWidth =
    rect.width;

  if (!containerWidth) {
    return;
  }

  const cellSize =
    containerWidth /
    gridDim;

  const gap =
    Math.min(
      15,
      15 *
      (
        containerWidth /
        700
      )
    );

  const tile =
    document.createElement(
      "div"
    );

  tile.className =
    isMain
      ? "tile main-tile"
      : "tile";

  const x =
    c * cellSize;

  const y =
    r * cellSize;

  const width =
    size * cellSize;

  const height =
    size * cellSize;

  tile.style.position =
    "absolute";

  tile.style.boxSizing =
    "border-box";

  tile.style.top =
    `${y + gap / 2}px`;

  tile.style.left =
    `${x + gap / 2}px`;

  tile.style.width =
    `${Math.max(
      0,
      width - gap
    )}px`;

  tile.style.height =
    `${Math.max(
      0,
      height - gap
    )}px`;

  tile.style.border =
    "none";

  tile.style.borderRadius =
    isMain
      ? "16px"
      : "12px";

  tile.style.overflow =
    "hidden";

  tile.style.background =
    "transparent";

  const img =
    document.createElement(
      "img"
    );

  img.src =
    imgSrc ||
    createFallbackAvatar();

  img.alt =
    "";

  img.style.width =
    "100%";

  img.style.height =
    "100%";

  img.style.objectFit =
    "cover";

  img.style.display =
    "block";

  img.style.border =
    "none";

  if (
    !isMain &&
    contact
  ) {
    const link =
      document.createElement(
        "a"
      );

    link.href =
      getBlueskyProfileUrl(
        contact.handle
      );

    link.target =
      "_blank";

    link.rel =
      "noopener noreferrer";

    link.style.display =
      "block";

    link.style.width =
      "100%";

    link.style.height =
      "100%";

    link.style.border =
      "none";

    link.appendChild(
      img
    );

    tile.appendChild(
      link
    );

  } else {
    tile.appendChild(
      img
    );
  }

  container.appendChild(
    tile
  );
}


function downloadImage() {
  const tiles =
    document.getElementById(
      "tilesContainer"
    );

  if (!tiles) {
    return;
  }

  const theme =
    CARD_THEMES[
      selectedTheme
    ];

  const finalSize =
    900;

  const mosaicSize =
    700;

  const scale =
    2;

  const originalInlineBackground =
    tiles.style.background;

  tiles.style.background =
    "transparent";

  html2canvas(
    tiles,
    {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false
    }
  )
    .then(canvas => {
      tiles.style.background =
        originalInlineBackground;

      const finalCanvas =
        document.createElement(
          "canvas"
        );

      finalCanvas.width =
        finalSize *
        scale;

      finalCanvas.height =
        finalSize *
        scale;

      const ctx =
        finalCanvas.getContext(
          "2d"
        );

      ctx.fillStyle =
        theme.background;

      ctx.fillRect(
        0,
        0,
        finalCanvas.width,
        finalCanvas.height
      );

      const gradient1 =
        ctx.createRadialGradient(
          130 * scale,
          120 * scale,
          0,
          130 * scale,
          120 * scale,
          500 * scale
        );

      gradient1.addColorStop(
        0,
        hexToRgba(
          theme.glow1,
          0.45
        )
      );

      gradient1.addColorStop(
        0.4,
        hexToRgba(
          theme.glow1,
          0.16
        )
      );

      gradient1.addColorStop(
        1,
        hexToRgba(
          theme.glow1,
          0
        )
      );

      ctx.fillStyle =
        gradient1;

      ctx.fillRect(
        0,
        0,
        finalCanvas.width,
        finalCanvas.height
      );

      const gradient2 =
        ctx.createRadialGradient(
          780 * scale,
          800 * scale,
          0,
          780 * scale,
          800 * scale,
          500 * scale
        );

      gradient2.addColorStop(
        0,
        hexToRgba(
          theme.glow2,
          0.30
        )
      );

      gradient2.addColorStop(
        0.45,
        hexToRgba(
          theme.glow2,
          0.10
        )
      );

      gradient2.addColorStop(
        1,
        hexToRgba(
          theme.glow2,
          0
        )
      );

      ctx.fillStyle =
        gradient2;

      ctx.fillRect(
        0,
        0,
        finalCanvas.width,
        finalCanvas.height
      );

      ctx.textAlign =
        "center";

      ctx.textBaseline =
        "middle";

      ctx.fillStyle =
        theme.text;

      ctx.font =
        "700 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

      ctx.fillText(
        "BlueSquare",
        finalCanvas.width / 2,
        58 * scale
      );

      const mosaicX =
        (finalSize -
          mosaicSize) /
        2;

      const mosaicY =
        100;

      ctx.save();

      ctx.shadowColor =
        "rgba(0,0,0,0.28)";

      ctx.shadowBlur =
        22 * scale;

      ctx.shadowOffsetY =
        6 * scale;

      ctx.drawImage(
        canvas,
        mosaicX * scale,
        mosaicY * scale,
        mosaicSize * scale,
        mosaicSize * scale
      );

      ctx.restore();

      ctx.fillStyle =
        theme.muted;

      ctx.font =
        "600 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

      ctx.fillText(
        "fralexander.github.io/bluesquare",
        finalCanvas.width / 2,
        850 * scale
      );

      const link =
        document.createElement(
          "a"
        );

      link.download =
        "bluesquare.png";

      link.href =
        finalCanvas.toDataURL(
          "image/png"
        );

      link.click();
    })
    .catch(error => {
      tiles.style.background =
        originalInlineBackground;

      console.error(
        "Unable to generate image:",
        error
      );
    });
}


function hexToRgba(
  hex,
  alpha
) {
  const value =
    hex.replace(
      "#",
      ""
    );

  const r =
    parseInt(
      value.substring(
        0,
        2
      ),
      16
    );

  const g =
    parseInt(
      value.substring(
        2,
        4
      ),
      16
    );

  const b =
    parseInt(
      value.substring(
        4,
        6
      ),
      16
    );

  return (
    `rgba(${r}, ${g}, ${b}, ${alpha})`
  );
}


document.addEventListener(
  "DOMContentLoaded",
  () => {
    createThemePicker();
  }
);
