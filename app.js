(() => {
  const { createClient } = supabase;

  const cfg = window.LEO_CONFIG || {};

  const db = createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_KEY
  );

  const app = document.getElementById("app");

  let state = {
    user: null,
    profile: null,
    screen: "home",
    chat: null,
    profiles: [],
    messages: [],
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
        })[c]
    );

  const toast = (m) => {
    const d = document.createElement("div");
    d.className = "toast";
    d.textContent = m;

    app
      .querySelector(".shell")
      ?.appendChild(d);

    setTimeout(() => d.remove(), 3000);
  };

  const icon = (x) =>
    `<span>${x}</span>`;

  /* =====================================================
     STARTUP
     ===================================================== */

  async function boot() {
    try {
      console.log("Leo Chat starting...");
      console.log(
        "Supabase URL:",
        cfg.SUPABASE_URL
      );
      console.log(
        "Publishable key loaded:",
        !!cfg.SUPABASE_KEY
      );

      const {
        data,
        error
      } = await db.auth.getSession();

      if (error) {
        console.error(
          "Supabase getSession error:",
          error
        );

        toast(
          `Supabase: ${error.message}`
        );
      }

      const session = data?.session;

      state.user =
        session?.user || null;

      if (state.user) {
        await loadProfile();
      }

      render();

      if (state.user) {
        startPolling();
      }

      db.auth.onAuthStateChange(
        async (_event, session) => {
          console.log(
            "Auth state changed:",
            _event
          );

          state.user =
            session?.user || null;

          if (state.user) {
            await loadProfile();
          } else {
            state.profile = null;
          }

          render();
        }
      );
    } catch (error) {
      console.error(
        "Leo Chat startup error:",
        error
      );

      render();

      toast(
        `Startup error: ${
          error.message || "Unknown error"
        }`
      );
    }
  }

  /* =====================================================
     PROFILE
     ===================================================== */

  async function loadProfile() {
    if (!state.user) return;

    try {
      const {
        data,
        error
      } = await db
        .from("profiles")
        .select("*")
        .eq("id", state.user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Profile loading error:",
          error
        );

        toast(
          `Profile: ${error.message}`
        );

        state.profile = null;
        return;
      }

      state.profile = data || null;
    } catch (error) {
      console.error(
        "Profile exception:",
        error
      );

      state.profile = null;
    }
  }

  async function getProfiles() {
    const {
      data,
      error
    } = await db
      .from("profiles")
      .select("*")
      .order("display_name");

    if (error) {
      console.error(
        "Profiles error:",
        error
      );

      return;
    }

    state.profiles = data || [];
  }

  /* =====================================================
     MESSAGES
     ===================================================== */

  async function getMessages() {
    if (
      !state.chat ||
      !state.user
    ) {
      return;
    }

    const a = state.user.id;
    const b = state.chat.id;

    const {
      data,
      error
    } = await db
      .from("messages")
      .select("*")
      .or(
        `and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`
      )
      .order("created_at", {
        ascending: true
      });

    if (error) {
      console.error(
        "Messages error:",
        error
      );

      return;
    }

    state.messages = data || [];
  }

  let poll;

  function startPolling() {
    clearInterval(poll);

    poll = setInterval(
      async () => {
        if (
          state.screen === "chat"
        ) {
          await getMessages();
          render();
        }
      },
      2500
    );
  }

  /* =====================================================
     LAYOUT
     ===================================================== */

  function layout(
    inner,
    nav = true
  ) {
    return `
      <div class="app">
        <div class="shell">
          ${inner}
          ${nav ? navBar() : ""}
        </div>
      </div>
    `;
  }

  function navBar() {
    const n = [
      ["home", "💬", "Chats"],
      ["search", "⌕", "Search"],
      ["moments", "✦", "Moments"],
      ["calls", "☎", "Calls"],
      ["settings", "⚙", "Settings"]
    ];

    return `
      <div class="nav">
        ${n
          .map(
            (x) => `
              <button
                class="${
                  state.screen === x[0]
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

  window.go = (s) => {
    state.screen = s;
    render();
  };

  window.openChat = async (p) => {
    state.chat = p;
    state.screen = "chat";
    state.messages = [];

    await getMessages();

    render();
  };

  /* =====================================================
     LOGOUT
     ===================================================== */

  window.logout = async () => {
    try {
      const {
        error
      } = await db.auth.signOut();

      if (error) {
        console.error(
          "Logout error:",
          error
        );

        toast(
          `Logout: ${error.message}`
        );

        return;
      }

      state.user = null;
      state.profile = null;
      state.chat = null;
      state.messages = [];
      state.screen = "home";

      render();
    } catch (error) {
      console.error(
        "Logout exception:",
        error
      );

      toast(
        `Logout error: ${
          error.message ||
          "Unknown error"
        }`
      );
    }
  };

  /* =====================================================
     MAIN RENDER
     ===================================================== */

  function render() {
    if (!state.user) {
      renderAuth();
      return;
    }

    if (!state.profile) {
      renderSetup();
      return;
    }

    if (state.screen === "chat") {
      renderChat();
      return;
    }

    if (state.screen === "search") {
      renderSearch();
      return;
    }

    if (state.screen === "moments") {
      renderMoments();
      return;
    }

    if (state.screen === "calls") {
      renderCalls();
      return;
    }

    if (state.screen === "settings") {
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

    renderHome();
  }

  /* =====================================================
     AUTH SCREEN
     ===================================================== */

  function renderAuth() {
    app.innerHTML = layout(
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

  /* =====================================================
     AUTHENTICATION
     ===================================================== */

  window.auth = async (mode) => {
    const emailEl =
      document.getElementById(
        "email"
      );

    const passwordEl =
      document.getElementById(
        "pass"
      );

    const email =
      emailEl?.value
        ?.trim() || "";

    const password =
      passwordEl?.value || "";

    if (!email || !password) {
      return toast(
        "Enter your email and password"
      );
    }

    try {
      toast(
        mode === "signup"
          ? "Creating account..."
          : "Signing in..."
      );

      console.log(
        "Leo Chat auth attempt:",
        mode,
        email
      );

      let result;

      if (mode === "signup") {
        result =
          await db.auth.signUp({
            email,
            password
          });
      } else {
        result =
          await db.auth.signInWithPassword(
            {
              email,
              password
            }
          );
      }

      console.log(
        "Leo Chat Supabase result:",
        result
      );

      if (result.error) {
        console.error(
          "Supabase authentication error:",
          result.error
        );

        return toast(
          `Supabase: ${
            result.error.message ||
            "Authentication failed"
          }`
        );
      }

      const user =
        result.data?.user;

      const session =
        result.data?.session;

      console.log(
        "Authenticated user:",
        user
      );

      console.log(
        "Session received:",
        !!session
      );

      /*
        SIGN UP WITH EMAIL CONFIRMATION
      */

      if (
        mode === "signup" &&
        !session
      ) {
        toast(
          "Account created. Check your email to confirm it."
        );

        return;
      }

      if (!user) {
        return toast(
          "Supabase did not return a user."
        );
      }

      state.user = user;

      await loadProfile();

      render();

      if (!state.profile) {
        toast(
          "Welcome to Leo Chat. Set up your profile."
        );
      }
    } catch (error) {
      console.error(
        "Leo Chat auth exception:",
        error
      );

      toast(
        `Auth error: ${
          error.message ||
          "Unknown error"
        }`
      );
    }
  };

  /* =====================================================
     PROFILE SETUP
     ===================================================== */

  function renderSetup() {
    app.innerHTML = layout(
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

  window.saveProfile = async () => {
    const username =
      document
        .getElementById("uname")
        ?.value
        ?.trim()
        ?.toLowerCase() || "";

    const display_name =
      document
        .getElementById("dname")
        ?.value
        ?.trim() || "";

    if (
      !username ||
      !display_name
    ) {
      return toast(
        "Complete your profile"
      );
    }

    try {
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
        console.error(
          "Profile creation error:",
          error
        );

        return toast(
          `Profile: ${error.message}`
        );
      }

      state.profile = data;

      render();
    } catch (error) {
      console.error(
        "Profile exception:",
        error
      );

      toast(
        `Profile error: ${
          error.message ||
          "Unknown error"
        }`
      );
    }
  };

  /* =====================================================
     HOME
     ===================================================== */

  async function renderHome() {
    await getProfiles();

    const people =
      state.profiles.filter(
        (p) =>
          p.id !==
          state.user.id
      );

    app.innerHTML = layout(
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
                      (p) => `
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

                          </div>

                          <div class="gold">
                            ›
                          </div>

                        </div>
                      `
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

  /* =====================================================
     SEARCH
     ===================================================== */

  function renderSearch() {
    app.innerHTML = layout(
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

            <div id="results"></div>

          </div>

        </div>
      `
    );

    filterPeople();
  }

  async function filterPeople() {
    await getProfiles();

    const q =
      (
        document
          .getElementById("q")
          ?.value || ""
      ).toLowerCase();

    const arr =
      state.profiles.filter(
        (p) =>
          p.id !==
            state.user.id &&
          (
            `${p.display_name} ${p.username}`
          )
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
          (p) => `
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

              </div>

            </div>
          `
        )
        .join("") ||
      `
        <div class="empty">
          No matches.
        </div>
      `;
  }

  /* =====================================================
     CHAT
     ===================================================== */

  function renderChat() {
    const p =
      state.chat;

    const msgs =
      state.messages;

    app.innerHTML = layout(
      `
        <div class="chat">

          <div class="chathead">

            <button
              class="back"
              onclick="go('home')"
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
                Leo Chat
              </div>

            </div>

            <button
              class="iconbtn"
              onclick="callUser('voice')"
            >
              ☎
            </button>

            <button
              class="iconbtn"
              onclick="callUser('video')"
            >
              ▣
            </button>

          </div>

          <div
            class="messages"
            id="messages"
          >

            ${
              msgs
                .map(
                  (m) => {
                    const image =
                      m.message?.startsWith(
                        "LEO_IMAGE::"
                      );

                    return `
                      <div
                        class="bubble ${
                          m.sender_id ===
                          state.user.id
                            ? "mine"
                            : "theirs"
                        }"
                      >
                        ${
                          image
                            ? `
                              <img
                                src="${esc(
                                  m.message.slice(
                                    11
                                  )
                                )}"
                              >
                            `
                            : esc(
                                m.message
                              )
                        }
                      </div>
                    `;
                  }
                )
                .join("") ||
              `
                <div class="empty">
                  Start the conversation 🦁
                </div>
              `
            }

          </div>

          <div class="composer">

            <label
              class="iconbtn"
              style="
                display:grid;
                place-items:center
              "
            >
              ＋

              <input
                id="photo"
                class="photo-btn"
                type="file"
                accept="image/*"
                onchange="sendPhoto(event)"
              >

            </label>

            <input
              id="msg"
              class="input"
              placeholder="Message..."
              onkeydown="
                if(event.key==='Enter')
                sendMsg()
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

    setTimeout(() => {
      const m =
        document.getElementById(
          "messages"
        );

      if (m) {
        m.scrollTop =
          m.scrollHeight;
      }
    }, 20);
  }

  /* =====================================================
     SEND MESSAGE
     ===================================================== */

  window.sendMsg = async () => {
    const el =
      document.getElementById(
        "msg"
      );

    const text =
      el?.value
        ?.trim() || "";

    if (!text) return;

    try {
      const {
        error
      } = await db
        .from("messages")
        .insert({
          sender_id:
            state.user.id,
          receiver_id:
            state.chat.id,
          message: text
        });

      if (error) {
        console.error(
          "Send message error:",
          error
        );

        return toast(
          `Message: ${error.message}`
        );
      }

      el.value = "";

      await getMessages();

      renderChat();
    } catch (error) {
      console.error(
        "Send message exception:",
        error
      );

      toast(
        `Message error: ${
          error.message ||
          "Unknown error"
        }`
      );
    }
  };

  /* =====================================================
     SEND PHOTO
     ===================================================== */

  window.sendPhoto = async (e) => {
    const f =
      e.target.files?.[0];

    if (!f) return;

    if (
      f.size >
      4 * 1024 * 1024
    ) {
      return toast(
        "Photo must be under 4 MB"
      );
    }

    const rd =
      new FileReader();

    rd.onload = async () => {
      try {
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
              "LEO_IMAGE::" +
              rd.result
          });

        if (error) {
          console.error(
            "Photo error:",
            error
          );

          return toast(
            `Photo: ${error.message}`
          );
        }

        await getMessages();

        renderChat();
      } catch (error) {
        console.error(
          "Photo exception:",
          error
        );

        toast(
          `Photo error: ${
            error.message ||
            "Unknown error"
          }`
        );
      }
    };

    rd.readAsDataURL(f);
  };

  /* =====================================================
     CALLS
     ===================================================== */

  window.callUser = (
    kind
  ) =>
    toast(
      `${
        kind === "video"
          ? "Video"
          : "Voice"
      } call screen ready — real calling needs WebRTC.`
    );

  /* =====================================================
     MOMENTS
     ===================================================== */

  function renderMoments() {
    app.innerHTML = layout(
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
                      (m) => `
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

  window.addMoment = (
    e
  ) => {
    const f =
      e.target.files?.[0];

    if (!f) return;

    const r =
      new FileReader();

    r.onload = () => {
      const text =
        prompt(
          "Moment caption"
        ) || "";

      state.moments.unshift({
        src: r.result,
        text,
        at: Date.now()
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

  /* =====================================================
     CALLS SCREEN
     ===================================================== */

  function renderCalls() {
    app.innerHTML = layout(
      `
        <div class="screen">

          <div class="top">

            <div class="brand">
              ${icon("☎")}
              Calls
            </div>

          </div>

          <div class="content">

            <div class="card center">

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
                Voice and video call controls
                are ready. A production call
                service/WebRTC connection is
                required for live audio and video.
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

  /* =====================================================
     SETTINGS
     ===================================================== */

  function renderSettings() {
    app.innerHTML = layout(
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
    k,
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
            state.settings[k]
              ? "checked"
              : ""
          }
          onchange="
            toggleSetting(
              '${k}',
              this.checked
            )
          "
        >

      </div>
    `;
  }

  window.toggleSetting = (
    k,
    v
  ) => {
    state.settings[k] = v;

    localStorage.setItem(
      "leo_settings",
      JSON.stringify(
        state.settings
      )
    );
  };

  /* =====================================================
     NOTIFICATIONS
     ===================================================== */

  function renderNotifications() {
    app.innerHTML = layout(
      `
        <div class="screen">

          <div class="top">

            <div class="brand">

              <button
                class="back"
                onclick="go('settings')"
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
                      (n) => `
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

  /* =====================================================
     SERVICE WORKER
     ===================================================== */

  if (
    "serviceWorker" in
    navigator
  ) {
    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker
          .register(
            "./sw.js"
          )
          .catch((error) => {
            console.log(
              "Service worker:",
              error
            );
          });
      }
    );
  }

  /* =====================================================
     START LEO CHAT
     ===================================================== */

  boot();

})();
