(() => {
  /* =========================================================
     LEO CHAT — WEB APP
     Real attachments + realtime presence
     ========================================================= */

  const cfg = window.LEO_CONFIG || {};

  const app = document.getElementById("app");

  /* ---------------------------------------------------------
     SUPABASE
     --------------------------------------------------------- */

  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    app.innerHTML = `
      <div class="app">
        <div class="shell">
          <div class="screen center">
            <img class="logo" src="./logo.svg">
            <h2>Leo Chat</h2>
            <p class="muted">
              Supabase could not be loaded.
            </p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const { createClient } = window.supabase;

  const db = createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_KEY
  );

  /* =========================================================
     APP STATE
     ========================================================= */

  let state = {
    user: null,
    profile: null,

    screen: "home",

    chat: null,

    profiles: [],

    messages: [],

    attachments: {},

    presence: {},

    moments: JSON.parse(
      localStorage.getItem("leo_moments") || "[]"
    ),

    notifications: JSON.parse(
      localStorage.getItem("leo_notifications") || "[]"
    ),

    settings: JSON.parse(
      localStorage.getItem("leo_settings") ||
        '{"messages":true,"calls":true,"moments":true}'
    )
  };

  let poll = null;

  let messageChannel = null;

  let presenceChannel = null;

  let authSubscription = null;

  /* =========================================================
     HELPERS
     ========================================================= */

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[c])
    );

  const toast = (message) => {
    const d = document.createElement("div");

    d.className = "toast";

    d.textContent = message;

    app
      .querySelector(".shell")
      ?.appendChild(d);

    setTimeout(() => {
      d.remove();
    }, 2500);
  };

  const icon = (x) =>
    `<span>${x}</span>`;

  function formatTime(value) {
    if (!value) return "";

    try {
      return new Date(value).toLocaleTimeString(
        [],
        {
          hour: "numeric",
          minute: "2-digit"
        }
      );
    } catch {
      return "";
    }
  }

  function formatLastSeen(value) {
    if (!value) {
      return "Offline";
    }

    try {
      const date = new Date(value);

      return (
        "last seen " +
        date.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        })
      );
    } catch {
      return "Offline";
    }
  }

  function isOnline(userId) {
    return Boolean(
      state.presence[userId]?.is_online
    );
  }

  /* =========================================================
     PRESENCE
     ========================================================= */

  async function ensurePresence() {
    if (!state.user) return;

    const now = new Date().toISOString();

    const { error } = await db
      .from("user_presence")
      .upsert(
        {
          user_id: state.user.id,
          is_online: true,
          last_seen_at: now,
          current_activity:
            state.screen === "chat"
              ? "chatting"
              : "online",
          updated_at: now
        },
        {
          onConflict: "user_id"
        }
      );

    if (error) {
      console.log(
        "Presence update:",
        error.message
      );
    }
  }

  async function updatePresenceActivity() {
    if (!state.user) return;

    const now = new Date().toISOString();

    await db
      .from("user_presence")
      .upsert(
        {
          user_id: state.user.id,
          is_online: true,
          last_seen_at: now,
          current_activity:
            state.screen === "chat"
              ? "chatting"
              : "online",
          updated_at: now
        },
        {
          onConflict: "user_id"
        }
      );
  }

  async function markOffline() {
    if (!state.user) return;

    try {
      await db
        .from("user_presence")
        .update({
          is_online: false,
          current_activity: "offline",
          last_seen_at:
            new Date().toISOString(),
          updated_at:
            new Date().toISOString()
        })
        .eq(
          "user_id",
          state.user.id
        );
    } catch (error) {
      console.log(
        "Offline update:",
        error.message
      );
    }
  }

  async function loadPresence() {
    if (!state.user) return;

    const { data, error } =
      await db
        .from("user_presence")
        .select(
          "user_id,is_online,last_seen_at,current_activity,updated_at"
        );

    if (error) {
      console.log(
        "Presence loading:",
        error.message
      );
      return;
    }

    state.presence = {};

    (data || []).forEach((item) => {
      state.presence[item.user_id] =
        item;
    });
  }

  async function startPresence() {
    if (!state.user) return;

    await ensurePresence();

    await loadPresence();

    if (presenceChannel) {
      await db
        .removeChannel(
          presenceChannel
        );
    }

    presenceChannel = db
      .channel("leo-presence", {
        config: {
          presence: {
            key: state.user.id
          }
        }
      });

    presenceChannel
      .on(
        "presence",
        {
          event: "sync"
        },
        async () => {
          await loadPresence();

          if (
            state.screen === "home" ||
            state.screen === "chat" ||
            state.screen === "search"
          ) {
            render();
          }
        }
      )
      .on(
        "presence",
        {
          event: "join"
        },
        async () => {
          await loadPresence();

          if (
            state.screen === "home" ||
            state.screen === "chat" ||
            state.screen === "search"
          ) {
            render();
          }
        }
      )
      .on(
        "presence",
        {
          event: "leave"
        },
        async () => {
          await loadPresence();

          if (
            state.screen === "home" ||
            state.screen === "chat" ||
            state.screen === "search"
          ) {
            render();
          }
        }
      )
      .subscribe(
        async (status) => {
          if (status === "SUBSCRIBED") {
            try {
              await presenceChannel.track(
                {
                  user_id:
                    state.user.id,
                  online: true,
                  activity:
                    state.screen === "chat"
                      ? "chatting"
                      : "online",
                  at: new Date().toISOString()
                }
              );
            } catch (error) {
              console.log(
                "Presence track:",
                error.message
              );
            }
          }
        }
      );
  }

  /* =========================================================
     PROFILE
     ========================================================= */

  async function loadProfile() {
    if (!state.user) return;

    const { data, error } =
      await db
        .from("profiles")
        .select("*")
        .eq("id", state.user.id)
        .maybeSingle();

    if (error) {
      console.log(
        "Profile:",
        error.message
      );
    }

    state.profile = data || null;
  }

  async function getProfiles() {
    if (!state.user) return;

    const { data, error } =
      await db
        .from("profiles")
        .select("*")
        .order("display_name");

    if (error) {
      console.log(
        "Profiles:",
        error.message
      );
      return;
    }

    state.profiles = data || [];
  }

  /* =========================================================
     MESSAGES
     ========================================================= */

  async function getMessages() {
    if (!state.chat || !state.user) {
      return;
    }

    const a = state.user.id;

    const b = state.chat.id;

    const { data, error } =
      await db
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`
        )
        .order("created_at", {
          ascending: true
        });

    if (error) {
      console.log(
        "Messages:",
        error.message
      );
      return;
    }

    state.messages = data || [];

    await loadAttachments();
  }

  /* =========================================================
     REAL ATTACHMENT RECORDS
     ========================================================= */

  async function loadAttachments() {
    if (!state.messages.length) {
      state.attachments = {};
      return;
    }

    const ids = state.messages.map(
      (m) => m.id
    );

    const { data, error } =
      await db
        .from("message_attachments")
        .select("*")
        .in("message_id", ids)
        .order("created_at", {
          ascending: true
        });

    if (error) {
      console.log(
        "Attachments:",
        error.message
      );
      return;
    }

    state.attachments = {};

    (data || []).forEach((item) => {
      if (!state.attachments[item.message_id]) {
        state.attachments[item.message_id] =
          [];
      }

      state.attachments[item.message_id].push(
        item
      );
    });
  }

  /* =========================================================
     STORAGE
     ========================================================= */

  function getAttachmentType(file) {
    const type =
      file.type || "";

    if (type.startsWith("image/")) {
      return "image";
    }

    if (type.startsWith("video/")) {
      return "video";
    }

    if (type.startsWith("audio/")) {
      return "audio";
    }

    if (
      type.includes("pdf") ||
      type.includes("document") ||
      type.includes("word") ||
      type.includes("text") ||
      type.includes("spreadsheet")
    ) {
      return "document";
    }

    return "file";
  }

  function cleanFileName(name) {
    return String(name)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 150);
  }

  async function uploadAttachment(file) {
    if (
      !file ||
      !state.user ||
      !state.chat
    ) {
      return;
    }

    const maxSize =
      100 * 1024 * 1024;

    if (file.size > maxSize) {
      toast(
        "File must be smaller than 100 MB"
      );
      return;
    }

    const type =
      getAttachmentType(file);

    toast("Uploading...");

    try {
      /* -----------------------------------------------------
         1. Create the message first.
         ----------------------------------------------------- */

      const { data: message, error: messageError } =
        await db
          .from("messages")
          .insert({
            sender_id: state.user.id,
            receiver_id: state.chat.id,
            message:
              type === "image"
                ? "📷 Photo"
                : type === "video"
                ? "🎥 Video"
                : type === "audio"
                ? "🎵 Audio"
                : "📎 File"
          })
          .select()
          .single();

      if (messageError) {
        throw messageError;
      }

      /* -----------------------------------------------------
         2. Create private storage path.

         USER_ID / MESSAGE_ID / FILE_NAME
         ----------------------------------------------------- */

      const safeName =
        cleanFileName(
          file.name ||
            `leo-file-${Date.now()}`
        );

      const path =
        `${state.user.id}/${message.id}/${Date.now()}-${safeName}`;

      /* -----------------------------------------------------
         3. Upload to Supabase Storage.
         ----------------------------------------------------- */

      const {
        error: uploadError
      } = await db.storage
        .from("chat-media")
        .upload(
          path,
          file,
          {
            cacheControl:
              "3600",
            upsert: false,
            contentType:
              file.type ||
              "application/octet-stream"
          }
        );

      if (uploadError) {
        /* Remove empty message if upload fails. */

        await db
          .from("messages")
          .delete()
          .eq(
            "id",
            message.id
          );

        throw uploadError;
      }

      /* -----------------------------------------------------
         4. Save attachment metadata.
         ----------------------------------------------------- */

      const {
        error: attachmentError
      } = await db
        .from("message_attachments")
        .insert({
          message_id:
            message.id,

          sender_id:
            state.user.id,

          file_name:
            file.name,

          file_path:
            path,

          mime_type:
            file.type ||
            "application/octet-stream",

          file_size:
            file.size,

          attachment_type:
            type
        });

      if (attachmentError) {
        /* Try to clean up uploaded file. */

        await db.storage
          .from("chat-media")
          .remove([path]);

        await db
          .from("messages")
          .delete()
          .eq(
            "id",
            message.id
          );

        throw attachmentError;
      }

      toast("Attachment sent");

      await getMessages();

      renderChat();

    } catch (error) {
      console.log(
        "Attachment upload:",
        error
      );

      toast(
        error.message ||
          "Attachment upload failed"
      );
    }
  }

  /* =========================================================
     GET PRIVATE STORAGE URL
     ========================================================= */

  async function getAttachmentUrl(path) {
    const {
      data,
      error
    } = await db.storage
      .from("chat-media")
      .createSignedUrl(
        path,
        3600
      );

    if (error) {
      console.log(
        "Signed URL:",
        error.message
      );

      return null;
    }

    return data?.signedUrl || null;
  }

  /* =========================================================
     OPEN ATTACHMENT
     ========================================================= */

  window.openAttachment =
    async (path, type) => {
      if (!path) return;

      toast("Opening...");

      const url =
        await getAttachmentUrl(
          path
        );

      if (!url) {
        return toast(
          "Could not open attachment"
        );
      }

      if (
        type === "image" ||
        type === "video" ||
        type === "audio"
      ) {
        window.open(
          url,
          "_blank",
          "noopener"
        );
      } else {
        const a =
          document.createElement(
            "a"
          );

        a.href = url;

        a.target = "_blank";

        a.rel =
          "noopener noreferrer";

        a.click();
      }
    };

  /* =========================================================
     RENDER ATTACHMENT
     ========================================================= */

  function renderAttachment(
    attachment
  ) {
    const safePath =
      encodeURIComponent(
        attachment.file_path
      );

    const safeType =
      encodeURIComponent(
        attachment.attachment_type
      );

    if (
      attachment.attachment_type ===
      "image"
    ) {
      return `
        <button
          class="attachment-image"
          onclick="openAttachment(
            decodeURIComponent('${safePath}'),
            decodeURIComponent('${safeType}')
          )"
        >
          <div class="attachment-loading">
            📷 Loading photo...
          </div>
        </button>
      `;
    }

    if (
      attachment.attachment_type ===
      "video"
    ) {
      return `
        <button
          class="attachment-file"
          onclick="openAttachment(
            decodeURIComponent('${safePath}'),
            decodeURIComponent('${safeType}')
          )"
        >
          🎥
          <span>
            ${esc(attachment.file_name)}
          </span>
        </button>
      `;
    }

    if (
      attachment.attachment_type ===
      "audio"
    ) {
      return `
        <button
          class="attachment-file"
          onclick="openAttachment(
            decodeURIComponent('${safePath}'),
            decodeURIComponent('${safeType}')
          )"
        >
          🎵
          <span>
            ${esc(attachment.file_name)}
          </span>
        </button>
      `;
    }

    return `
      <button
        class="attachment-file"
        onclick="openAttachment(
          decodeURIComponent('${safePath}'),
          decodeURIComponent('${safeType}')
        )"
      >
        📎
        <span>
          ${esc(attachment.file_name)}
        </span>
      </button>
    `;
  }

  /* =========================================================
     LOAD IMAGE URLS FOR DISPLAY
     ========================================================= */

  async function prepareAttachmentUrls() {
    for (
      const messageId in state.attachments
    ) {
      const list =
        state.attachments[
          messageId
        ];

      for (
        const attachment of list
      ) {
        if (
          attachment.attachment_type ===
          "image"
        ) {
          const url =
            await getAttachmentUrl(
              attachment.file_path
            );

          attachment.signedUrl =
            url;
        }
      }
    }
  }

  /* =========================================================
     POLLING FALLBACK
     ========================================================= */

  function startPolling() {
    clearInterval(poll);

    poll = setInterval(
      async () => {
        if (
          state.screen ===
          "chat"
        ) {
          await getMessages();

          await updatePresenceActivity();

          renderChat();
        } else if (
          state.screen ===
            "home" ||
          state.screen ===
            "search"
        ) {
          await loadPresence();
        }
      },
      5000
    );
  }

  /* =========================================================
     REALTIME MESSAGES
     ========================================================= */

  async function startMessageRealtime() {
    if (!state.user) return;

    if (messageChannel) {
      await db.removeChannel(
        messageChannel
      );
    }

    messageChannel =
      db
        .channel(
          "leo-messages-" +
            state.user.id
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter:
              `receiver_id=eq.${state.user.id}`
          },
          async () => {
            if (
              state.screen ===
              "chat"
            ) {
              await getMessages();

              renderChat();
            } else {
              addNotification(
                "New message",
                "You have a new Leo Chat message."
              );
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table:
              "message_attachments"
          },
          async () => {
            if (
              state.screen ===
              "chat"
            ) {
              await getMessages();

              renderChat();
            }
          }
        )
        .subscribe();
  }

  /* =========================================================
     LAYOUT
     ========================================================= */

  function layout(
    inner,
    nav = true
  ) {
    return `
      <div class="app">
        <div class="shell">
          ${inner}
          ${
            nav
              ? navBar()
              : ""
          }
        </div>
      </div>
    `;
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function navBar() {
    const n = [
      [
        "home",
        "💬",
        "Chats"
      ],
      [
        "search",
        "⌕",
        "Search"
      ],
      [
        "moments",
        "✦",
        "Moments"
      ],
      [
        "calls",
        "☎",
        "Calls"
      ],
      [
        "settings",
        "⚙",
        "Settings"
      ]
    ];

    return `
      <div class="nav">
        ${n
          .map(
            (x) =>
              `
              <button
                class="${
                  state.screen ===
                  x[0]
                    ? "active"
                    : ""
                }"
                onclick="go('${x[0]}')"
              >
                ${icon(x[1])}
                <b>${x[2]}</b>
              </button>
              `
          )
          .join("")}
      </div>
    `;
  }

  window.go = async (
    screen
  ) => {
    state.screen = screen;

    await updatePresenceActivity();

    render();
  };

  /* =========================================================
     OPEN CHAT
     ========================================================= */

  window.openChat =
    async (person) => {
      state.chat = person;

      state.screen = "chat";

      state.messages = [];

      state.attachments = {};

      await updatePresenceActivity();

      await getMessages();

      renderChat();
    };

  /* =========================================================
     LOGOUT
     ========================================================= */

  window.logout =
    async () => {
      try {
        await markOffline();
      } catch {}

      if (presenceChannel) {
        try {
          await presenceChannel.untrack();
        } catch {}

        await db.removeChannel(
          presenceChannel
        );

        presenceChannel = null;
      }

      if (messageChannel) {
        await db.removeChannel(
          messageChannel
        );

        messageChannel = null;
      }

      clearInterval(poll);

      await db.auth.signOut();

      state.user = null;

      state.profile = null;

      state.chat = null;

      state.messages = [];

      state.attachments = {};

      state.screen = "home";

      render();
    };

  /* =========================================================
     AUTH
     ========================================================= */

  function renderAuth() {
    app.innerHTML =
      layout(
        `
        <div
          class="screen center"
          style="
            justify-content:center;
            padding:28px
          "
        >

          <img
            class="logo"
            src="./logo.svg"
          >

          <h1>Leo Chat</h1>

          <p class="muted">
            Chat. Connect. Roar.
          </p>

          <input
            id="email"
            class="input"
            placeholder="Email"
            type="email"
            autocomplete="email"
          >

          <input
            id="pass"
            class="input"
            placeholder="Password"
            type="password"
            autocomplete="current-password"
          >

          <button
            class="btn"
            onclick="auth('signin')"
          >
            Sign in
          </button>

          <button
            class="btn secondary"
            onclick="auth('signup')"
          >
            Create account
          </button>

        </div>
        `,
        false
      );
  }

  window.auth =
    async (mode) => {
      const email =
        document
          .getElementById(
            "email"
          )
          ?.value
          .trim();

      const password =
        document
          .getElementById(
            "pass"
          )
          ?.value;

      if (
        !email ||
        !password
      ) {
        return toast(
          "Enter email and password"
        );
      }

      toast(
        mode ===
          "signup"
          ? "Creating account..."
          : "Signing in..."
      );

      const r =
        mode ===
        "signup"
          ? await db.auth.signUp(
              {
                email,
                password
              }
            )
          : await db.auth.signInWithPassword(
              {
                email,
                password
              }
            );

      if (r.error) {
        return toast(
          r.error.message
        );
      }

      state.user =
        r.data.user;

      await loadProfile();

      await startPresence();

      await startMessageRealtime();

      startPolling();

      render();
    };

  /* =========================================================
     PROFILE SETUP
     ========================================================= */

  function renderSetup() {
    app.innerHTML =
      layout(
        `
        <div
          class="screen center"
          style="
            justify-content:center;
            padding:25px
          "
        >

          <img
            class="logo"
            src="./logo.svg"
          >

          <h2>
            Set up your Leo profile
          </h2>

          <input
            id="uname"
            class="input"
            placeholder="Username"
            autocomplete="username"
          >

          <input
            id="dname"
            class="input"
            placeholder="Display name"
            autocomplete="name"
          >

          <button
            class="btn"
            onclick="saveProfile()"
          >
            Enter Leo Chat
          </button>

        </div>
        `,
        false
      );
  }

  window.saveProfile =
    async () => {
      const username =
        document
          .getElementById(
            "uname"
          )
          ?.value
          .trim()
          .toLowerCase();

      const display_name =
        document
          .getElementById(
            "dname"
          )
          ?.value
          .trim();

      if (
        !username ||
        !display_name
      ) {
        return toast(
          "Complete your profile"
        );
      }

      const {
        data,
        error
      } = await db
        .from("profiles")
        .insert({
          id: state.user.id,
          username,
          display_name,
          avatar: "🦁"
        })
        .select()
        .single();

      if (error) {
        return toast(
          error.message
        );
      }

      state.profile =
        data;

      await ensurePresence();

      render();
    };

  /* =========================================================
     HOME
     ========================================================= */

  async function renderHome() {
    await getProfiles();

    await loadPresence();

    const people =
      state.profiles.filter(
        (p) =>
          p.id !==
          state.user.id
      );

    app.innerHTML =
      layout(
        `
        <div class="screen">

          <div class="top">

            <div class="brand">

              <img
                src="./logo.svg"
              >

              Leo Chat

            </div>

            <button
              class="iconbtn"
              onclick="
                state.screen='notifications';
                render()
              "
            >
              🔔
            </button>

          </div>

          <div class="content">

            <div class="card">

              <div class="row">

                <div class="avatar">
                  🦁
                </div>

                <div class="grow">

                  <div class="name">
                    ${esc(
                      state.profile
                        .display_name
                    )}
                  </div>

                  <div class="sub">
                    @${esc(
                      state.profile
                        .username
                    )}
                  </div>

                  <div class="online-status">
                    <span class="status-dot online"></span>
                    Online
                  </div>

                </div>

              </div>

            </div>

            <h3>
              People
            </h3>

            ${
              people.length
                ? people
                    .map(
                      (p) => {
                        const online =
                          isOnline(
                            p.id
                          );

                        return `
                          <div
                            class="listitem"
                            onclick='openChat(${JSON.stringify(
                              p
                            )})'
                          >

                            <div class="avatar">
                              ${esc(
                                p.avatar ||
                                  "🦁"
                              )}
                            </div>

                            <div class="grow">

                              <div class="name">
                                ${esc(
                                  p.display_name
                                )}
                              </div>

                              <div class="sub">
                                @${esc(
                                  p.username
                                )}
                              </div>

                              <div class="online-status">

                                <span
                                  class="status-dot ${
                                    online
                                      ? "online"
                                      : "offline"
                                  }"
                                ></span>

                                ${
                                  online
                                    ? "Online"
                                    : formatLastSeen(
                                        state
                                          .presence[
                                          p.id
                                        ]
                                          ?.last_seen_at
                                      )
                                }

                              </div>

                            </div>

                            <div class="gold">
                              ›
                            </div>

                          </div>
                        `;
                      }
                    )
                    .join("")
                : `
                  <div class="empty">
                    No other Leo users yet.
                  </div>
                `
            }

          </div>

        </div>
        `
      );
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  function renderSearch() {
    app.innerHTML =
      layout(
        `
        <div class="screen">

          <div class="top">

            <div class="brand">
              ${icon("⌕")}
              Search
            </div>

          </div>

          <div class="content">

            <input
              id="q"
              class="input search"
              placeholder="Search people..."
              oninput="filterPeople()"
            >

            <div
              id="results"
            ></div>

          </div>

        </div>
        `
      );

    filterPeople();
  }

  async function filterPeople() {
    await getProfiles();

    await loadPresence();

    const q =
      (
        document
          .getElementById(
            "q"
          )
          ?.value ||
        ""
      ).toLowerCase();

    const arr =
      state.profiles.filter(
        (p) =>
          p.id !==
            state.user.id &&
          `${p.display_name} ${p.username}`
            .toLowerCase()
            .includes(q)
      );

    const r =
      document.getElementById(
        "results"
      );

    if (!r) return;

    r.innerHTML =
      arr
        .map(
          (p) => {
            const online =
              isOnline(
                p.id
              );

            return `
              <div
                class="listitem"
                onclick='openChat(${JSON.stringify(
                  p
                )})'
              >

                <div class="avatar">
                  ${esc(
                    p.avatar ||
                      "🦁"
                  )}
                </div>

                <div class="grow">

                  <div class="name">
                    ${esc(
                      p.display_name
                    )}
                  </div>

                  <div class="sub">
                    @${esc(
                      p.username
                    )}
                  </div>

                  <div class="online-status">

                    <span
                      class="status-dot ${
                        online
                          ? "online"
                          : "offline"
                      }"
                    ></span>

                    ${
                      online
                        ? "Online"
                        : formatLastSeen(
                            state
                              .presence[
                              p.id
                            ]
                              ?.last_seen_at
                          )
                    }

                  </div>

                </div>

              </div>
            `;
          }
        )
        .join("") ||
      `
        <div class="empty">
          No matches.
        </div>
      `;
  }

  /* =========================================================
     CHAT
     ========================================================= */

  async function renderChat() {
    const p =
      state.chat;

    const msgs =
      state.messages;

    if (!p) {
      state.screen =
        "home";

      return renderHome();
    }

    const online =
      isOnline(
        p.id
      );

    app.innerHTML =
      layout(
        `
        <div class="chat">

          <div class="chathead">

            <button
              class="back"
              onclick="leaveChat()"
            >
              ‹
            </button>

            <div class="avatar">
              ${esc(
                p.avatar ||
                  "🦁"
              )}
            </div>

            <div class="grow">

              <div class="name">
                ${esc(
                  p.display_name
                )}
              </div>

              <div class="sub">

                <span
                  class="status-dot ${
                    online
                      ? "online"
                      : "offline"
                  }"
                ></span>

                ${
                  online
                    ? "Online"
                    : formatLastSeen(
                        state
                          .presence[
                          p.id
                        ]
                          ?.last_seen_at
                      )
                }

              </div>

            </div>

            <button
              class="iconbtn"
              onclick="callUser('voice')"
              title="Voice call"
            >
              ☎
            </button>

            <button
              class="iconbtn"
              onclick="callUser('video')"
              title="Video call"
            >
              ▣
            </button>

          </div>

          <div
            class="messages"
            id="messages"
          >

            ${
              msgs.length
                ? msgs
                    .map(
                      (m) =>
                        renderMessage(
                          m
                        )
                    )
                    .join("")
                : `
                  <div class="empty">
                    Start the conversation 🦁
                  </div>
                `
            }

          </div>

          <div class="composer">

            <button
              class="iconbtn"
              onclick="document.getElementById('attachmentInput').click()"
              title="Attach"
            >
              ＋
            </button>

            <input
              id="attachmentInput"
              class="photo-btn"
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
              multiple
              onchange="handleAttachments(event)"
            >

            <input
              id="msg"
              class="input"
              placeholder="Message..."
              autocomplete="off"
              onkeydown="
                if(event.key==='Enter' && !event.shiftKey){
                  event.preventDefault();
                  sendMsg();
                }
              "
            >

            <button
              class="send"
              onclick="sendMsg()"
            >
              ➤
            </button>

          </div>

        </div>
        `,
        false
      );

    await prepareAttachmentUrls();

    renderAttachmentImages();

    setTimeout(() => {
      const m =
        document.getElementById(
          "messages"
        );

      if (m) {
        m.scrollTop =
          m.scrollHeight;
      }
    }, 30);
  }

  function renderMessage(
    message
  ) {
    const mine =
      message.sender_id ===
      state.user.id;

    const list =
      state.attachments[
        message.id
      ] || [];

    return `
      <div
        class="bubble ${
          mine
            ? "mine"
            : "theirs"
        }"
      >

        ${
          message.message
            ? `
              <div>
                ${esc(
                  message.message
                )}
              </div>
            `
            : ""
        }

        ${
          list.length
            ? `
              <div
                class="attachment-list"
              >
                ${list
                  .map(
                    (
                      attachment
                    ) =>
                      renderAttachment(
                        attachment
                      )
                  )
                  .join("")}
              </div>
            `
            : ""
        }

        <div class="message-meta">
          ${formatTime(
            message.created_at
          )}

          ${
            mine
              ? " ✓✓"
              : ""
          }
        </div>

      </div>
    `;
  }

  /* =========================================================
     DISPLAY REAL IMAGE PREVIEWS
     ========================================================= */

  function renderAttachmentImages() {
    const images =
      document.querySelectorAll(
        ".attachment-image"
      );

    images.forEach(
      (button) => {
        const encoded =
          button.dataset?.path;

        if (encoded) return;
      }
    );

    const attachments =
      document.querySelectorAll(
        ".attachment-image"
      );

    attachments.forEach(
      (element) => {
        const onclick =
          element.getAttribute(
            "onclick"
          );

        if (!onclick) return;

        const match =
          onclick.match(
            /decodeURIComponent\('([^']+)'\)/
          );

        if (!match) return;

        const path =
          decodeURIComponent(
            match[1]
          );

        getAttachmentUrl(
          path
        ).then(
          (url) => {
            if (!url) return;

            element.innerHTML = `
              <img
                src="${esc(url)}"
                alt="Leo Chat photo"
                style="
                  max-width:100%;
                  display:block;
                  border-radius:12px;
                "
              >
            `;
          }
        );
      }
    );
  }

  /* =========================================================
     SEND TEXT MESSAGE
     ========================================================= */

  window.sendMsg =
    async () => {
      const el =
        document.getElementById(
          "msg"
        );

      const text =
        el?.value.trim();

      if (!text) return;

      if (
        !state.user ||
        !state.chat
      ) {
        return;
      }

      el.value = "";

      const {
        error
      } = await db
        .from("messages")
        .insert({
          sender_id:
            state.user.id,

          receiver_id:
            state.chat.id,

          message:
            text
        });

      if (error) {
        el.value =
          text;

        return toast(
          error.message
        );
      }

      await getMessages();

      renderChat();

      await updatePresenceActivity();
    };

  /* =========================================================
     REAL ATTACHMENTS
     ========================================================= */

  window.handleAttachments =
    async (event) => {
      const files =
        Array.from(
          event.target
            ?.files || []
        );

      if (!files.length) {
        return;
      }

      for (
        const file of files
      ) {
        await uploadAttachment(
          file
        );
      }

      event.target.value =
        "";

      await getMessages();

      renderChat();
    };

  /* =========================================================
     CALLS
     ========================================================= */

  window.callUser =
    (kind) => {
      toast(
        `${
          kind === "video"
            ? "Video"
            : "Voice"
        } calling will be connected in the WebRTC call module.`
      );
    };

  /* =========================================================
     LEAVE CHAT
     ========================================================= */

  window.leaveChat =
    async () => {
      state.chat =
        null;

      state.messages =
        [];

      state.attachments =
        {};

      state.screen =
        "home";

      await updatePresenceActivity();

      render();
    };

  /* =========================================================
     MOMENTS
     ========================================================= */

  function renderMoments() {
    app.innerHTML =
      layout(
        `
        <div class="screen">

          <div class="top">

            <div class="brand">
              ${icon("✦")}
              Moments
            </div>

            <button
              class="iconbtn"
              onclick="
                document
                  .getElementById(
                    'momentFile'
                  )
                  .click()
              "
            >
              ＋
            </button>

            <input
              id="momentFile"
              class="photo-btn"
              type="file"
              accept="image/*"
              onchange="addMoment(event)"
            >

          </div>

          <div class="content">

            ${
              state.moments.length
                ? state.moments
                    .map(
                      (m) =>
                        `
                        <div class="moment">

                          <img
                            src="${esc(
                              m.src
                            )}"
                          >

                          <p>

                            ${esc(
                              m.text ||
                                "Leo Moment"
                            )}

                            <br>

                            <span class="muted">
                              ${new Date(
                                m.at
                              ).toLocaleString()}
                            </span>

                          </p>

                        </div>
                        `
                    )
                    .join("")
                : `
                  <div class="empty">

                    <div
                      style="
                        font-size:50px
                      "
                    >
                      ✦
                    </div>

                    No moments yet.

                  </div>
                `
            }

          </div>

        </div>
        `
      );
  }

  window.addMoment =
    (e) => {
      const f =
        e.target?.files?.[0];

      if (!f) return;

      const r =
        new FileReader();

      r.onload = () => {
        const text =
          prompt(
            "Moment caption"
          ) || "";

        state.moments.unshift({
          src:
            r.result,

          text,

          at:
            Date.now()
        });

        localStorage.setItem(
          "leo_moments",
          JSON.stringify(
            state.moments
          )
        );

        renderMoments();
      };

      r.readAsDataURL(f);
    };

  /* =========================================================
     CALLS SCREEN
     ========================================================= */

  function renderCalls() {
    app.innerHTML =
      layout(
        `
        <div class="screen">

          <div class="top">

            <div class="brand">
              ${icon("☎")}
              Calls
            </div>

          </div>

          <div class="content">

            <div
              class="card center"
            >

              <img
                class="logo"
                style="
                  width:80px;
                  height:80px
                "
                src="./logo.svg"
              >

              <h2>
                Leo Calls
              </h2>

              <p class="muted">
                Voice and video calls
                will use WebRTC for
                live audio and video.
              </p>

              <button
                class="btn"
                onclick="
                  toast(
                    'Choose a person from Chats to call'
                  )
                "
              >
                Start a call
              </button>

            </div>

          </div>

        </div>
        `
      );
  }

  /* =========================================================
     SETTINGS
     ========================================================= */

  function renderSettings() {
    app.innerHTML =
      layout(
        `
        <div class="screen">

          <div class="top">

            <div class="brand">
              ${icon("⚙")}
              Settings
            </div>

          </div>

          <div class="content">

            <div class="card">

              <h3>
                Profile
              </h3>

              <div class="row">

                <div class="avatar">
                  🦁
                </div>

                <div class="grow">

                  <div class="name">
                    ${esc(
                      state.profile
                        .display_name
                    )}
                  </div>

                  <div class="sub">
                    @${esc(
                      state.profile
                        .username
                    )}
                  </div>

                </div>

              </div>

            </div>

            <div class="card">

              <h3>
                Notifications
              </h3>

              ${settingRow(
                "messages",
                "Messages"
              )}

              ${settingRow(
                "calls",
                "Calls"
              )}

              ${settingRow(
                "moments",
                "Moments"
              )}

            </div>

            <button
              class="btn secondary"
              onclick="
                state.screen='notifications';
                render()
              "
            >
              🔔 Notifications
            </button>

            <button
              class="btn secondary"
              onclick="logout()"
            >
              Log out
            </button>

          </div>

        </div>
        `
      );
  }

  function settingRow(
    key,
    label
  ) {
    return `
      <div
        class="row"
        style="
          padding:10px 0;
          border-bottom:1px solid #222
        "
      >

        <div class="grow">
          ${label}
        </div>

        <input
          class="switch"
          type="checkbox"
          ${
            state.settings[key]
              ? "checked"
              : ""
          }
          onchange="
            toggleSetting(
              '${key}',
              this.checked
            )
          "
        >

      </div>
    `;
  }

  window.toggleSetting =
    (key, value) => {
      state.settings[key] =
        value;

      localStorage.setItem(
        "leo_settings",
        JSON.stringify(
          state.settings
        )
      );
    };

  /* =========================================================
     NOTIFICATIONS
     ========================================================= */

  function addNotification(
    title,
    body
  ) {
    if (
      !state.settings.messages
    ) {
      return;
    }

    state.notifications.unshift({
      title,
      body,
      at:
        Date.now()
    });

    state.notifications =
      state.notifications.slice(
        0,
        50
      );

    localStorage.setItem(
      "leo_notifications",
      JSON.stringify(
        state.notifications
      )
    );

    if (
      state.screen !==
      "notifications"
    ) {
      toast(
        title
      );
    }
  }

  function renderNotifications() {
    app.innerHTML =
      layout(
        `
        <div class="screen">

          <div class="top">

            <div class="brand">

              <button
                class="back"
                onclick="
                  go('settings')
                "
              >
                ‹
              </button>

              ${icon("🔔")}
              Notifications

            </div>

          </div>

          <div class="content">

            ${
              state.notifications
                .length
                ? state.notifications
                    .map(
                      (n) =>
                        `
                        <div class="card">

                          <div class="name">
                            ${esc(
                              n.title
                            )}
                          </div>

                          <div class="sub">
                            ${esc(
                              n.body
                            )}
                          </div>

                          <div class="muted">
                            ${n.at
                              ? new Date(
                                  n.at
                                ).toLocaleString()
                              : ""}
                          </div>

                        </div>
                        `
                    )
                    .join("")
                : `
                  <div class="empty">
                    No notifications yet.
                  </div>
                `
            }

          </div>

        </div>
        `
      );
  }

  /* =========================================================
     RENDER ROUTER
     ========================================================= */

  async function render() {
    if (!state.user) {
      renderAuth();
      return;
    }

    if (!state.profile) {
      renderSetup();
      return;
    }

    if (
      state.screen ===
      "chat"
    ) {
      await renderChat();
      return;
    }

    if (
      state.screen ===
      "search"
    ) {
      renderSearch();
      return;
    }

    if (
      state.screen ===
      "moments"
    ) {
      renderMoments();
      return;
    }

    if (
      state.screen ===
      "calls"
    ) {
      renderCalls();
      return;
    }

    if (
      state.screen ===
      "settings"
    ) {
      renderSettings();
      return;
    }

    if (
      state.screen ===
      "notifications"
    ) {
      renderNotifications();
      return;
    }

    await renderHome();
  }

  /* =========================================================
     AUTH STATE
     ========================================================= */

  function startAuthListener() {
    if (authSubscription) {
      return;
    }

    const {
      data
    } =
      db.auth.onAuthStateChange(
        async (
          event,
          session
        ) => {
          state.user =
            session?.user ||
            null;

          if (
            state.user
          ) {
            await loadProfile();

            await startPresence();

            await startMessageRealtime();

            startPolling();
          } else {
            state.profile =
              null;

            clearInterval(
              poll
            );
          }

          render();
        }
      );

    authSubscription =
      data?.subscription ||
      null;
  }

  /* =========================================================
     BOOT
     ========================================================= */

  async function boot() {
    try {
      if (
        !cfg.SUPABASE_URL ||
        !cfg.SUPABASE_KEY
      ) {
        app.innerHTML =
          layout(
            `
            <div class="screen center">

              <img
                class="logo"
                src="./logo.svg"
              >

              <h2>
                Leo Chat
              </h2>

              <p class="muted">
                Supabase configuration
                is missing.
              </p>

            </div>
            `,
            false
          );

        return;
      }

      app.innerHTML =
        layout(
          `
          <div
            class="screen center"
            style="
              justify-content:center
            "
          >

            <img
              class="logo"
              src="./logo.svg"
            >

            <h2>
              Leo Chat
            </h2>

            <p class="muted">
              Connecting...
            </p>

          </div>
          `,
          false
        );

      const {
        data,
        error
      } =
        await db.auth.getSession();

      if (error) {
        throw error;
      }

      state.user =
        data?.session?.user ||
        null;

      if (
        state.user
      ) {
        await loadProfile();

        await startPresence();

        await startMessageRealtime();

        startPolling();
      }

      startAuthListener();

      await render();

    } catch (error) {
      console.log(
        "Leo Chat startup:",
        error
      );

      app.innerHTML =
        layout(
          `
          <div
            class="screen center"
            style="
              justify-content:center;
              padding:25px
            "
          >

            <img
              class="logo"
              src="./logo.svg"
            >

            <h2>
              Leo Chat
            </h2>

            <p class="muted">
              ${esc(
                error.message ||
                  "Could not connect to Leo Chat."
              )}
            </p>

            <button
              class="btn"
              onclick="location.reload()"
            >
              Try Again
            </button>

          </div>
          `,
          false
        );
    }
  }

  /* =========================================================
     PAGE LIFECYCLE
     ========================================================= */

  window.addEventListener(
    "beforeunload",
    () => {
      if (state.user) {
        /*
          Best-effort update. Browsers may not wait for
          asynchronous requests during unload.
        */
        markOffline();
      }
    }
  );

  document.addEventListener(
    "visibilitychange",
    async () => {
      if (!state.user) return;

      if (
        document.visibilityState ===
        "visible"
      ) {
        await ensurePresence();

        if (
          presenceChannel
        ) {
          try {
            await presenceChannel.track(
              {
                user_id:
                  state.user.id,
                online: true,
                activity:
                  state.screen ===
                  "chat"
                    ? "chatting"
                    : "online",
                at:
                  new Date().toISOString()
              }
            );
          } catch {}
        }
      }
    }
  );

  /* =========================================================
     START
     ========================================================= */

  boot();
})();
