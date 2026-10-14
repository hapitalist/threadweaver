/* store.js — account + entitlements + buy, bolted onto the existing shell.
   It does NOT replace the app's unlock logic. It feeds real purchases into the
   same localStorage map ("wannabe.unlocked") that isUnlocked()/ownsAll() already read,
   so every existing game/book/comic/Weave lock check just works. */
(function () {
  "use strict";

  var SUPABASE_URL = "https://nzkgurdmvgkizvzisqxt.supabase.co";
  var SUPABASE_ANON = "sb_publishable_XhncOLTTqr5qTs_G9O3Ecw_m6m5fU0f";
  var FN = SUPABASE_URL + "/functions/v1";
  var UNLOCK_KEY = "wannabe.unlocked"; // same key the shell uses

  var sb = null;      // supabase client
  var session = null; // current auth session

  // --- supabase-js: vendored classic script (lib/supabase.js, global SBVendor).
  //     NOT a dynamic import: WKWebView blocks ES-module loading on the app's
  //     local origin, which killed the login buttons on iOS review devices. ---
  function showPasswordReset() {
    var ov = document.getElementById("pwReset");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "pwReset";
      ov.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(10,8,16,.96);display:flex;align-items:center;justify-content:center;padding:20px";
      ov.innerHTML =
        '<div style="max-width:360px;width:100%;background:#15101f;border:1px solid #e8b53a55;border-radius:12px;padding:26px 22px;font-family:\'Cormorant Garamond\',Georgia,serif;color:#ece3d0">' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:3px;color:#e8b53a;margin-bottom:10px">SET A NEW PASSWORD</div>' +
        '<p style="margin:0 0 14px;font-size:15px;color:#bfb4d8">You followed a password-reset link. Choose your new password below.</p>' +
        '<input id="pwNew" type="password" placeholder="New password (min 6 characters)" style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3a2f55;background:#0e0a18;color:#ece3d0;font-size:15px;margin-bottom:10px">' +
        '<input id="pwNew2" type="password" placeholder="Repeat new password" style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3a2f55;background:#0e0a18;color:#ece3d0;font-size:15px;margin-bottom:14px">' +
        '<button id="pwGo" style="width:100%;padding:12px;border-radius:8px;border:0;background:#e8b53a;color:#16121f;font-family:\'DM Mono\',monospace;font-size:12px;letter-spacing:2px;cursor:pointer">SAVE PASSWORD</button>' +
        '<div id="pwMsg" style="min-height:20px;margin-top:10px;font-size:14px"></div>' +
        "</div>";
      document.body.appendChild(ov);
      document.getElementById("pwGo").onclick = function () {
        var p1 = document.getElementById("pwNew").value, p2 = document.getElementById("pwNew2").value;
        var m = document.getElementById("pwMsg");
        if (!p1 || p1.length < 6) { m.style.color = "#e0a0a0"; m.textContent = "Password must be at least 6 characters."; return; }
        if (p1 !== p2) { m.style.color = "#e0a0a0"; m.textContent = "Passwords don\u2019t match."; return; }
        m.style.color = "#bfb4d8"; m.textContent = "Saving\u2026";
        sb.auth.updateUser({ password: p1 }).then(function (res) {
          if (res.error) { m.style.color = "#e0a0a0"; m.textContent = authErrMsg(res.error, "reset"); return; }
          m.style.color = "#9fe0b0"; m.textContent = "Password updated. Signing you in\u2026";
          setTimeout(function () {
            ov.remove();
            hideLoginWall(); document.body.classList.remove("pre-auth"); refreshEntitlements();
          }, 900);
        }).catch(function () { m.style.color = "#e0a0a0"; m.textContent = "Network error \u2014 your password was not changed. Try again."; });
      };
    }
    ov.style.display = "flex";
  }

  function loadSupabase() {
    return (window.SBVendor ? Promise.resolve(window.SBVendor) : Promise.reject(new Error("supabase vendor script missing")))
      .then(function (m) {
        sb = m.createClient(SUPABASE_URL, SUPABASE_ANON, {
          auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" }
        });

        // Recovery links can arrive two ways: (a) PKCE, which fires the
        // PASSWORD_RECOVERY auth event handled below; (b) the default Supabase
        // email template, which puts tokens in the URL hash (#access_token=...
        // &type=recovery) and fires no such event. Handle (b) explicitly so the
        // set-new-password form always appears. (Pattern proven in the Joy Looper app.)
        try {
          var _h = window.location.hash || "";
          if (_h.indexOf("access_token") >= 0 && _h.indexOf("type=recovery") >= 0) {
            var _p = new URLSearchParams(_h.replace(/^#/, ""));
            var _at = _p.get("access_token"), _rt = _p.get("refresh_token");
            if (_at && _rt) {
              sb.auth.setSession({ access_token: _at, refresh_token: _rt }).then(function (r) {
                try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) {}
                if (r && r.error) { showLoginWall("That reset link has expired. Request a new one below."); return; }
                showPasswordReset();
              }).catch(function () { showLoginWall("That reset link has expired. Request a new one below."); });
            }
          }
        } catch (e) {}
        return sb;
      });
  }

  // --- rebuild the shell's unlock map from the server's grant list ---
  // Previously this only ever OR'd keys in, so nothing was ever revoked: a
  // refund, a chargeback or a membership downgrade left the content unlocked
  // forever, and a second user signing in on the same device inherited the
  // first user's purchases. We now track which keys the server granted and
  // which account they belong to, and rebuild rather than merge.
  var SERVER_KEYS_KEY = UNLOCK_KEY + ".server";  // keys last granted by the server
  var OWNER_KEY       = UNLOCK_KEY + ".owner";   // which user this map belongs to

  function clearServerGrants() {
    try {
      var u = JSON.parse(localStorage.getItem(UNLOCK_KEY) || "{}");
      var prev = JSON.parse(localStorage.getItem(SERVER_KEYS_KEY) || "[]");
      prev.forEach(function (k) { delete u[k]; });
      localStorage.setItem(UNLOCK_KEY, JSON.stringify(u));
      localStorage.removeItem(SERVER_KEYS_KEY);
      localStorage.removeItem(OWNER_KEY);
    } catch (e) {}
  }

  function applyEntitlements(grants) {
    grants = grants || [];
    var uid = (session && session.user && session.user.id) || null;
    var u = {};
    try { u = JSON.parse(localStorage.getItem(UNLOCK_KEY) || "{}"); } catch (e) {}

    // Different account on this device? Start from empty, or the previous
    // person's purchases stay unlocked for whoever logs in next.
    var prevOwner = null;
    try { prevOwner = localStorage.getItem(OWNER_KEY); } catch (e) {}
    if (uid && prevOwner && prevOwner !== uid) { u = {}; }

    // Remove whatever the server granted LAST time. Anything it still grants is
    // re-added below; anything it dropped (refund/downgrade) stays gone. Keys
    // set locally (e.g. an app-store purchase) are untouched.
    try {
      JSON.parse(localStorage.getItem(SERVER_KEYS_KEY) || "[]").forEach(function (k) { delete u[k]; });
    } catch (e) {}

    var applied = [];
    function grant(k) { u[k] = true; applied.push(k); }

    grants.forEach(grant);
    // If they own everything, the shell's ownsAll() looks for "unlock_all"
    if (grants.indexOf("unlock_all") >= 0) grant("unlock_all");
    // all_games: map to every game id the shell knows
    if (grants.indexOf("all_games") >= 0 && window.GAMES) {
      window.GAMES.forEach(function (game) { grant(game.id); });
    }
    try {
      localStorage.setItem(UNLOCK_KEY, JSON.stringify(u));
      localStorage.setItem(SERVER_KEYS_KEY, JSON.stringify(applied));
      if (uid) localStorage.setItem(OWNER_KEY, uid);
    } catch (e) {}
    // ask the shell to re-render shelves if it exposes a refresh hook
    if (typeof window.renderShelves === "function") { try { window.renderShelves(); } catch (e) {} }
    if (typeof window.renderAll === "function") { try { window.renderAll(); } catch (e) {} }
  }

  // --- fetch entitlements for the logged-in user ---
  function refreshEntitlements() {
    if (!sb || !session) return Promise.resolve([]);
    return sb.rpc("my_entitlements").then(function (res) {
      // supabase-js RESOLVES with {data:null, error:...} on a DB/RLS failure
      // rather than rejecting. Passing that straight through as [] would look
      // identical to "this user owns nothing" and — now that applyEntitlements
      // actually revokes — would strip a paying customer's access on a blip.
      // Only apply on a clean read.
      if (res && res.error) { console.warn("entitlement check failed", res.error); return []; }
      var grants = (res && res.data) ? res.data : [];
      applyEntitlements(grants);
      return grants;
    }).catch(function (e) { console.warn("entitlement check failed", e); return []; });
  }

  // --- account strip UI (injected at top of #shell) ---
  function renderAccount() {
    var bar = document.getElementById("acctbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "acctbar";
      bar.style.cssText = "position:relative;z-index:160;max-width:920px;margin:0 auto;padding:10px 20px 0;display:flex;justify-content:flex-end;align-items:center;gap:10px;font-family:'DM Mono',monospace;font-size:12px;color:#9b91ac";
      var shell = document.getElementById("shell") || document.body;
      shell.parentNode.insertBefore(bar, shell);
    }
    if (session && session.user) {
      bar.innerHTML =
        '<span style="color:#9b91ac">' + (session.user.email || "signed in") + '</span>' +
        '<button id="btnSignout" style="font-family:inherit;font-size:11px;background:#191324;border:1px solid #2e2742;color:#e8b53a;padding:6px 12px;border-radius:8px;cursor:pointer">Sign out</button>' +
        '<button id="btnDelAcct" style="font-family:inherit;font-size:11px;background:#191324;border:1px solid #5a2130;color:#e08a8a;padding:6px 12px;border-radius:8px;cursor:pointer">Delete account</button>';
      document.getElementById("btnSignout").onclick = signOut;
      document.getElementById("btnDelAcct").onclick = showDeleteAccount;
    } else {
      bar.innerHTML =
        '<span style="color:#6f6685;margin-right:2px">Reading on more than one device?</span>' +
        '<button id="btnSignin" style="font-family:inherit;font-size:11px;background:linear-gradient(150deg,#e8b53a,#b8862a);border:none;color:#16121f;padding:7px 14px;border-radius:8px;cursor:pointer;font-weight:700">Log in to save your place</button>';
      document.getElementById("btnSignin").onclick = promptSignin;
    }
  }

  function promptSignin() {
    showLoginWall();
  }
  // Expose sign-in + session state so other modules (fun.js rank-save nudge) can use them.
  window.promptSignin = promptSignin;
  window.getSession = function(){ return session; };

  // --- full-screen login wall: email + password, with Log In / Sign Up tabs ---
  var _authMode = "login"; // or "signup"
  function showLoginWall(msg) {
    var w = document.getElementById("loginWall");
    // The wall is built once, then hidden/shown. hideLoginWall() sets display:none,
    // so ALWAYS restore display here -- otherwise a rebuilt-but-hidden wall makes the
    // "Log in to save your place" button look dead. (Apple 2.1(a), build 11464.)
    if (w) { w.style.display = "flex"; }
    if (!w) {
      w = document.createElement("div");
      w.id = "loginWall";
      w.style.cssText = "position:fixed;inset:0;z-index:99999;background:radial-gradient(120% 90% at 50% 30%,#1a1330,#08060f);display:flex;align-items:center;justify-content:center;padding:24px;font-family:'DM Mono',monospace;overflow-y:auto";
      w.innerHTML =
        '<div style="max-width:380px;width:100%;text-align:center">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:30px;color:#e8b53a;letter-spacing:2px;margin-bottom:6px">THREAD WEAVER</div>' +
          '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:17px;color:#cdbfe6;line-height:1.4;margin-bottom:20px">Your library, your place in every book, and your purchases live in your account \u2014 on every device.</div>' +
          // tabs
          '<div style="display:flex;gap:0;margin-bottom:18px;border:1px solid #2e2742;border-radius:10px;overflow:hidden">' +
            '<button id="lwTabLogin" style="flex:1;background:#241640;border:none;color:#e8b53a;padding:11px;font-family:inherit;font-size:13px;cursor:pointer;font-weight:700">Log In</button>' +
            '<button id="lwTabSignup" style="flex:1;background:transparent;border:none;color:#9b91ac;padding:11px;font-family:inherit;font-size:13px;cursor:pointer">Sign Up</button>' +
          '</div>' +
          // name (signup only)
          '<input id="lwName" type="text" autocomplete="name" placeholder="Your name" ' +
            'style="display:none;width:100%;box-sizing:border-box;background:#0e0b16;border:1px solid #2e2742;color:#ece3d0;border-radius:10px;padding:14px;font-size:16px;font-family:inherit;margin-bottom:10px;text-align:center">' +
          '<input id="lwEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" ' +
            'style="width:100%;box-sizing:border-box;background:#0e0b16;border:1px solid #2e2742;color:#ece3d0;border-radius:10px;padding:14px;font-size:16px;font-family:inherit;margin-bottom:10px;text-align:center">' +
          '<input id="lwPass" type="password" autocomplete="current-password" placeholder="Password" ' +
            'style="width:100%;box-sizing:border-box;background:#0e0b16;border:1px solid #2e2742;color:#ece3d0;border-radius:10px;padding:14px;font-size:16px;font-family:inherit;margin-bottom:12px;text-align:center">' +
          '<button id="lwGo" style="width:100%;box-sizing:border-box;background:linear-gradient(150deg,#e8b53a,#b8862a);border:none;color:#16121f;font-weight:700;padding:14px;border-radius:10px;font-size:15px;font-family:inherit;cursor:pointer">Log In</button>' +
          '<div id="lwForgot" style="font-size:12px;color:#9b91ac;margin-top:12px;cursor:pointer;text-decoration:underline">Forgot password?</div>' +
          '<div id="lwMagic" style="font-size:12px;color:#9b91ac;margin-top:8px;cursor:pointer;text-decoration:underline">Email me a one-tap sign-in link</div>' +
          '<div id="lwMsg" style="font-size:12px;color:#9b91ac;margin-top:12px;min-height:18px;line-height:1.4"></div>' +
        '</div>';
      document.body.appendChild(w);

      var nameEl = document.getElementById("lwName");
      var emailEl = document.getElementById("lwEmail");
      var passEl = document.getElementById("lwPass");
      var go = document.getElementById("lwGo");
      var tabLogin = document.getElementById("lwTabLogin");
      var tabSignup = document.getElementById("lwTabSignup");
      var forgot = document.getElementById("lwForgot");
      var magic = document.getElementById("lwMagic");
      function msgEl() { return document.getElementById("lwMsg"); }

      function setMode(mode) {
        _authMode = mode;
        var login = mode === "login";
        tabLogin.style.background = login ? "#241640" : "transparent";
        tabLogin.style.color = login ? "#e8b53a" : "#9b91ac";
        tabLogin.style.fontWeight = login ? "700" : "400";
        tabSignup.style.background = login ? "transparent" : "#241640";
        tabSignup.style.color = login ? "#9b91ac" : "#e8b53a";
        tabSignup.style.fontWeight = login ? "400" : "700";
        nameEl.style.display = login ? "none" : "block";
        passEl.setAttribute("autocomplete", login ? "current-password" : "new-password");
        go.textContent = login ? "Log In" : "Create my account";
        forgot.style.display = login ? "block" : "none";
        msgEl().textContent = "";
      }
      tabLogin.onclick = function () { setMode("login"); };
      tabSignup.onclick = function () { setMode("signup"); };

      function submit() {
        var email = (emailEl.value || "").trim();
        var pass = (passEl.value || "");
        var m = msgEl();
        if (!email || email.indexOf("@") < 1) { m.style.color = "#e0a0a0"; m.textContent = "Enter a valid email address."; return; }
        if (pass.length < 6) { m.style.color = "#e0a0a0"; m.textContent = "Password must be at least 6 characters."; return; }
        go.disabled = true;
        m.style.color = "#9b91ac"; m.textContent = _authMode === "signup" ? "Creating your account\u2026" : "Logging in\u2026";

        if (_authMode === "signup") {
          var name = (nameEl.value || "").trim();
          // 1.16.0: Thread Weaver sends its own confirmation email (tw-auth), so the link is always right.
          twAuth("signup", { email: email, password: pass, name: name }).then(function (r) {
            go.disabled = false;
            // setMode() clears the message line, so switch tabs FIRST, then say why.
            if (r.exists) {
              setMode("login");
              m.style.color = "#e0a0a0";
              m.textContent = "That email already has a Thread Weaver account. Log in \u2014 or tap Forgot password.";
              return;
            }
            if (!r.ok) { m.style.color = "#e0a0a0"; m.textContent = r.error || "Couldn't create the account. Try again."; return; }
            setMode("login");
            m.style.color = "#9fe0b0"; m.textContent = "Account created. Check your email and tap the link to confirm \u2014 that signs you in.";
          });
        } else {
          sb.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
            go.disabled = false;
            if (res.error) { m.style.color = "#e0a0a0"; m.textContent = "Wrong email or password. Try again, or sign up."; return; }
            m.style.color = "#9fe0b0"; m.textContent = "Loading your library\u2026";
            // onAuthStateChange unlocks the app
          }).catch(function () { go.disabled = false; m.style.color = "#e0a0a0"; m.textContent = "Network error. Try again."; });
        }
      }
      go.onclick = submit;
      passEl.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      emailEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { if (_authMode === "signup") { document.getElementById("lwPass").focus(); } else submit(); } });

      magic.onclick = function () {
        var email = (emailEl.value || "").trim();
        var m = msgEl();
        if (!email || email.indexOf("@") < 1) { m.style.color = "#e0a0a0"; m.textContent = "Enter your email above first, then tap the sign-in link."; return; }
        m.style.color = "#9b91ac"; m.textContent = "Sending\u2026";
        twAuth("magic", { email: email }).then(function (r) {
          if (!r.ok) { m.style.color = "#e0a0a0"; m.textContent = r.error || "Couldn't send the link. Try again."; }
          else { m.style.color = "#9fe0b0"; m.textContent = "Sign-in link sent \u2014 open it on this device and you\u2019re in. No password needed."; }
        });
      };

      forgot.onclick = function () {
        var email = (emailEl.value || "").trim();
        var m = msgEl();
        if (!email || email.indexOf("@") < 1) { m.style.color = "#e0a0a0"; m.textContent = "Enter your email above first, then tap Forgot password."; return; }
        twAuth("recover", { email: email }).then(function (r) {
          if (!r.ok) { m.style.color = "#e0a0a0"; m.textContent = r.error || "Couldn't send the email. Try again."; }
          else { m.style.color = "#9fe0b0"; m.textContent = "Password reset email sent. Check your inbox."; }
        });
      };

      setMode("login");
    }
    w.style.display = "flex";
    if (msg) { var mm = document.getElementById("lwMsg"); if (mm) mm.textContent = msg; }
  }
  function hideLoginWall() {
    var w = document.getElementById("loginWall");
    if (w) w.style.display = "none";
  }

  function showDeleteAccount() {
    if (!session || !session.user) return;
    var ov = document.getElementById("delAcct");
    if (ov) { ov.style.display = "flex"; return; }
    ov = document.createElement("div");
    ov.id = "delAcct";
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(10,8,16,.96);display:flex;align-items:center;justify-content:center;padding:20px";
    ov.innerHTML =
      '<div style="max-width:380px;width:100%;background:#15101f;border:1px solid #5a2130;border-radius:12px;padding:26px 22px;font-family:\'Cormorant Garamond\',Georgia,serif;color:#ece3d0">' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:3px;color:#e08a8a;margin-bottom:10px">DELETE ACCOUNT</div>' +
      '<p style="margin:0 0 12px;font-size:16px;color:#cdbfe6">This permanently deletes your account and all associated data \u2014 your reading progress, bookmarks, notes, and purchase records on this account. This cannot be undone.</p>' +
      '<p style="margin:0 0 14px;font-size:14px;color:#9b91ac">Type <b style="color:#e08a8a">DELETE</b> to confirm.</p>' +
      '<input id="delConfirm" type="text" autocomplete="off" placeholder="DELETE" style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3a2f55;background:#0e0a18;color:#ece3d0;font-size:15px;margin-bottom:14px">' +
      '<div style="display:flex;gap:10px">' +
      '<button id="delGo" style="flex:1;padding:12px;border-radius:8px;border:0;background:#7a2436;color:#ffe;font-family:\'DM Mono\',monospace;font-size:12px;letter-spacing:2px;cursor:pointer">DELETE MY ACCOUNT</button>' +
      '<button id="delCancel" style="flex:1;padding:12px;border-radius:8px;border:1px solid #3a2f55;background:#191324;color:#cdbfe6;font-family:\'DM Mono\',monospace;font-size:12px;letter-spacing:2px;cursor:pointer">CANCEL</button>' +
      '</div>' +
      '<div id="delMsg" style="min-height:20px;margin-top:12px;font-size:14px"></div>' +
      "</div>";
    document.body.appendChild(ov);
    document.getElementById("delCancel").onclick = function () { ov.style.display = "none"; };
    document.getElementById("delGo").onclick = function () {
      var m = document.getElementById("delMsg");
      if ((document.getElementById("delConfirm").value || "").trim().toUpperCase() !== "DELETE") {
        m.style.color = "#e0a0a0"; m.textContent = "Type DELETE to confirm."; return;
      }
      m.style.color = "#9b91ac"; m.textContent = "Deleting your account\u2026";
      var token = (session && session.access_token) ? session.access_token : null;
      fetch(SUPABASE_URL + "/functions/v1/delete-account", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || res.j.error) { m.style.color = "#e0a0a0"; m.textContent = (res.j && res.j.error) ? res.j.error : "Could not delete right now. Please try again."; return; }
          m.style.color = "#9fe0b0"; m.textContent = "Your account has been deleted.";
          setTimeout(function () {
            try { sb.auth.signOut(); } catch (e) {}
            try { localStorage.clear(); } catch (e) {}
            ov.remove();
            location.reload();
          }, 1400);
        })
        .catch(function () { m.style.color = "#e0a0a0"; m.textContent = "Network error. Please try again."; });
    };
    ov.style.display = "flex";
  }

  function signOut() {
    sb.auth.signOut().then(function () {
      // Clear ONLY what the server granted. Wiping the whole map used to destroy
      // app-store purchases made before signing in, which are held locally and
      // have no server record until they're verified.
      clearServerGrants();
      session = null;
      renderAccount();
      if (typeof window.renderShelves === "function") { try { window.renderShelves(); } catch (e) {} }
      location.reload();
    });
  }

  // --- platform detection: native store vs web ---
  // On iOS we must use Apple IAP; on Android, Google Play Billing; on web, Stripe.
  // Available IMMEDIATELY (before deviceready). A packaged app never loads over http(s);
  // the website always does. Used to gate the login wall, which must run at first paint
  // -- window.cordova.platformId isn't populated yet at that point on a real device.
  function isNativeShell() {
    try {
      var proto = (location.protocol || "").toLowerCase();
      if (proto === "file:" || proto === "capacitor:" || proto === "ionic:" || proto === "app:") return true;
      if (window.cordova || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return true;
      // WKWebView / Cordova user-agent hint
      if (/\bwv\b/.test(navigator.userAgent) && !/Chrome\/[.0-9]* Mobile/.test(navigator.userAgent)) return false;
    } catch (e) {}
    return false;
  }

  // Canonical redirect base for auth emails. If the page was reached via a /www/ path
  // leak (relative link resolving against the internal folder), strip it so the magic
  // link points at the clean URL that's in Supabase's redirect allow-list -- otherwise
  // Supabase falls back to the project Site URL (a DIFFERENT app).
  function authRedirect() {
    // Point auth emails at THIS app's confirm handler. The email template uses
    // {{ .RedirectTo }} = this value, so every app's link returns to its own domain,
    // regardless of the shared Supabase Site URL.
    // 1.14.82: inside the native app origin is "null" / app:// / file:// - never a
    // valid email link. Only trust real http(s) origins; otherwise use the site.
    var SITE = "https://thread.wannabepress.com";
    try {
      var origin = window.location.origin;               // e.g. https://thread.wannabepress.com
      if (!/^https?:\/\//.test(origin || "") || /\/\/localhost(:|$)/.test(origin)) origin = SITE;
      return origin + "/auth/confirm?next=/app";
    } catch (e) {
      return SITE + "/auth/confirm?next=/app";
    }
  }

  // Turn any auth error into a human message. Supabase errors sometimes have an empty
  // .message (renders as "{}"); never show that. Detect common cases explicitly.
  // 1.16.0: sign-up, reset and sign-in-link emails go through Thread Weaver's own sender.
  // Always resolves to { ok, error?, exists? } - never rejects.
  function twAuth(action, body) {
    return fetch(FN + "/tw-auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, body || {}))
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (j && j.exists) return { exists: true };
        if (r.ok && j && j.ok) return { ok: true };
        return { ok: false, error: (j && j.error) || "Something went wrong. Try again in a minute." };
      });
    }).catch(function () { return { ok: false, error: "Network error. Try again." }; });
  }

  function authErrMsg(err, mode) {
    var raw = "";
    try { raw = (err && (err.message || err.error_description || err.msg)) || ""; } catch (e) {}
    var low = (raw || "").toLowerCase();
    if (low.indexOf("already") >= 0 || low.indexOf("registered") >= 0 || low.indexOf("exists") >= 0)
      return "This email already has an account. Switch to Log In.";
    if (low.indexOf("invalid") >= 0 && low.indexOf("credential") >= 0)
      return "Wrong email or password. Try again, or reset it below.";
    if (low.indexOf("weak") >= 0 || low.indexOf("pwned") >= 0)
      return "Please choose a stronger password.";
    if (low.indexOf("rate") >= 0 || low.indexOf("too many") >= 0)
      return "Too many attempts. Wait a minute and try again.";
    if (low.indexOf("confirm") >= 0)
      return "Please confirm your email first — check your inbox.";
    if (raw) return raw;                       // some real message we didn't special-case
    return (mode === "signup")
      ? "Couldn\u2019t create the account. If you already have one, switch to Log In."
      : "Something went wrong. Please try again.";
  }

  function nativePlatform() {
    var cdv = window.cordova;
    if (!cdv || !cdv.platformId) return null;
    var p = cdv.platformId.toLowerCase();
    if (p === "ios") return "ios";
    if (p === "android") return "android";
    return null;
  }

  // store-specific product id for a bundle (matches apple_iap_products / google_play_products)
  function bundleFromProductId(pid, plat) {
    if (!pid) return null;
    if (plat === "android") {
      return pid.indexOf("threadweaver_") === 0 ? pid.slice("threadweaver_".length) : null;
    }
    // ios: strip the app-id prefix, map the two suffixed collision ids back
    var APPLE_BACK = { all_games1: "all_games", godsverse_series1: "godsverse_series" };
    var pfx = "com.russellnohelty.threadweaver.";
    if (pid.indexOf(pfx) !== 0) return null;
    var raw = pid.slice(pfx.length);
    return APPLE_BACK[raw] || raw;
  }

  function productIdFor(bundle, plat) {
    // two bundles needed unique Apple ids (collision with pre-existing products on the team)
    var APPLE_OVERRIDE = {
      all_games: "com.russellnohelty.threadweaver.all_games1",
      godsverse_series: "com.russellnohelty.threadweaver.godsverse_series1"
    };
    if (plat === "ios") return APPLE_OVERRIDE[bundle] || ("com.russellnohelty.threadweaver." + bundle);
    if (plat === "android") return "threadweaver_" + bundle;
    return null;
  }

  // --- the cordova-plugin-purchase (StoreKit / Play Billing) integration ---
  var _iapReady = false;
  var _iapStore = null;
  function initIAP() {
    if (_iapReady) return Promise.resolve(_iapStore);
    var plat = nativePlatform();
    if (!plat) return Promise.resolve(null);
    var store = window.CdvPurchase ? window.CdvPurchase.store : window.store; // v13 exposes CdvPurchase
    if (!store) return Promise.resolve(null);
    _iapStore = store;
    // Stamp the buyer's user id onto the transaction (appAccountToken on iOS,
    // obfuscatedAccountId on Android). Apple echoes it back in refund
    // notifications, which is how a refund finds the right account when there's
    // no recorded receipt row for that transaction.
    try {
      store.applicationUsername = function () {
        return (session && session.user && session.user.id) || undefined;
      };
    } catch (e) {}
    var P = window.CdvPurchase || {};
    var TYPE = (P.ProductType && P.ProductType.NON_CONSUMABLE) || "non consumable";
    var APPLE = (P.Platform && P.Platform.APPLE_APPSTORE) || "ios-appstore";
    var GOOGLE = (P.Platform && P.Platform.GOOGLE_PLAY) || "android-playstore";
    var thisPlat = (plat === "ios") ? APPLE : GOOGLE;

    // register all 7 bundles as non-consumable products for this platform
    var bundles = ["all_games","dragonstrife_series","godsverse_series","ichabod_series","obsidian_series","quest_girls_series","unlock_all"];
    var regs = bundles.map(function (b) {
      return { id: productIdFor(b, plat), type: TYPE, platform: thisPlat };
    });
    try { store.register(regs); } catch (e) {}

    // when a purchase is approved -> verify with our backend -> finish
    store.when().approved(function (transaction) {
      // Grant immediately + locally so the purchase works even with no account
      // (Apple sandbox review has none). If signed in, also record it server-side
      // so it syncs to other devices.
      try {
        var prodId = (transaction.products && transaction.products[0] && transaction.products[0].id) || transaction.id;
        var bundle = bundleFromProductId(prodId, plat);
        if (bundle && window.setUnlocked) window.setUnlocked(bundle);
        if (window.renderAll) window.renderAll();
      } catch (e) {}
      // 1.14.82: only a confirmed server OK counts. Anything else (signed out,
      // offline, server error) is parked in the pending queue and replayed later.
      // The store transaction is still finished - the unlock is already granted
      // locally above, and Apple/Google keep the purchase in the device receipt.
      var slim = slimTx(transaction, plat);
      verifyNativePurchase(slim, plat)
        .then(function (ok) { if (!ok) queuePendingIAP(slim, plat); })
        .then(function () { try { transaction.finish(); } catch (e) {} })
        .then(function () { setTimeout(refreshEntitlements, 800); });
    });
    store.when().verified(function (receipt) { try { receipt.finish(); } catch (e) {} });

    return store.initialize([thisPlat]).then(function () {
      _iapReady = true;
      return store.update().then(function () { return store; }).catch(function () { return store; });
    }).catch(function () { return store; });
  }

  // A receipt that can't be verified yet (bought before signing in — the store
  // copy explicitly promises "no account needed to buy") used to be dropped on
  // the floor and finish()ed anyway, so it existed nowhere but this device's
  // localStorage. Park it and replay after the next sign-in.
  var PENDING_IAP_KEY = "wannabe.pendingIAP";
  var PENDING_MAX_TRIES = 8;

  // 1.14.82: the plugin's transaction object is circular (transaction -> receipt ->
  // transactions) so JSON.stringify threw and nothing was ever queued. Keep only
  // the plain fields the verify functions need.
  function slimTx(transaction, plat) {
    var t = transaction || {};
    var np = t.nativePurchase || {};
    return {
      prodId: (t.products && t.products[0] && t.products[0].id) || t.id || null,
      transactionId: t.transactionId || np.transactionId || null,
      purchaseToken: np.purchaseToken || np.purchase_token || t.purchaseToken || null,
      plat: plat
    };
  }

  // Apple's verifyReceipt needs the device's base64 App Store receipt - the one
  // receipt holds every purchase on this device, so it's read fresh on each try.
  function appleReceiptB64() {
    try {
      var s = _iapStore || (window.CdvPurchase && window.CdvPurchase.store);
      var lr = (s && s.localReceipts) || [];
      for (var i = 0; i < lr.length; i++) {
        var nd = lr[i] && lr[i].nativeData;
        if (nd && typeof nd.appStoreReceipt === "string" && nd.appStoreReceipt.length > 20) return nd.appStoreReceipt;
      }
    } catch (e) {}
    return "";
  }

  function queuePendingIAP(slim, plat) {
    try {
      if (!slim || !slim.prodId) return;
      var q = JSON.parse(localStorage.getItem(PENDING_IAP_KEY) || "[]");
      if (q.some(function (r) { return r.prodId === slim.prodId; })) return;
      q.push({ prodId: slim.prodId, plat: plat, tx: slim, tries: 0, at: Date.now() });
      localStorage.setItem(PENDING_IAP_KEY, JSON.stringify(q));
    } catch (e) {}
  }
  function flushPendingIAP() {
    if (!session) return Promise.resolve();
    var q = [];
    try { q = JSON.parse(localStorage.getItem(PENDING_IAP_KEY) || "[]"); } catch (e) { return Promise.resolve(); }
    if (!q.length) return Promise.resolve();
    return Promise.all(q.map(function (r) {
      // entries saved by 1.14.81 hold a raw transaction; slimTx reads them too
      var slim = (r.tx && r.tx.plat) ? r.tx : slimTx(r.tx, r.plat);
      if (!slim.prodId) slim.prodId = r.prodId;
      return verifyNativePurchase(slim, r.plat).then(function (ok) {
        if (ok) return null;
        r.tries = (r.tries || 0) + 1;
        return r.tries >= PENDING_MAX_TRIES ? null : r;
      }).catch(function () { return r; });
    })).then(function (left) {
      var still = left.filter(Boolean);
      try { localStorage.setItem(PENDING_IAP_KEY, JSON.stringify(still)); } catch (e) {}
      if (still.length !== q.length) { return refreshEntitlements(); }
    });
  }

  // POST the native receipt to the matching verify function; it writes the
  // entitlement into the same table my_entitlements reads.
  // Resolves true ONLY on a confirmed server OK; false otherwise (never throws).
  function verifyNativePurchase(slim, plat) {
    if (!session) return Promise.resolve(false);
    var token = session.access_token;
    var fn = (plat === "ios") ? "/apple-iap-verify" : "/google-play-verify";
    var payload;
    if (plat === "ios") {
      var rc = appleReceiptB64();
      if (!rc) return Promise.resolve(false);           // receipt not loaded yet - retry later
      payload = { transaction_id: slim.transactionId, product_id: slim.prodId, receipt: rc };
    } else {
      if (!slim.purchaseToken) return Promise.resolve(false);
      payload = { purchase_token: slim.purchaseToken, product_id: slim.prodId };
    }
    return fetch(FN + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return !!(r.ok && d && !d.error && (d.ok === true || d.granted || d.success));
      });
    }).catch(function () { return false; });
  }

  // --- BUY: platform-aware. iOS->Apple IAP, Android->Google Play, web->Stripe ---
  window.buyBundle = function (bundle) {
    var plat = nativePlatform();

    if (plat) {
      // NATIVE: Apple / Google. Apple 2.1(b): the purchase MUST work without forcing
      // sign-in first (App Review tests in a sandbox with no app account). StoreKit
      // handles the transaction; we grant the unlock locally on success and only use
      // an account (offered after) to SYNC the purchase across devices.
      initIAP().then(function (store) {
        if (!store) { alert("The store isn't ready yet. Please try again in a moment."); return; }
        var pid = productIdFor(bundle, plat);
        var product = store.get ? store.get(pid) : null;
        var offer = product && (product.getOffer ? product.getOffer() : (product.offers && product.offers[0]));
        if (offer && offer.order) { offer.order(); return; }
        if (product && product.order) { product.order(); return; }
        // fallback for older plugin api
        if (store.order) { store.order(pid); return; }
        alert("That item isn't available from the store right now.");
      });
      return;
    }

    // WEB: existing Stripe checkout
    if (!session || !session.access_token) {
      // Reachable in the packaged app (native never force-gates) and on web if
      // the session expired between page load and tap. Reading .access_token off
      // null threw synchronously, outside the fetch chain, so no .catch ran and
      // the sheet sat on "Opening secure checkout..." forever.
      showLoginWall("Sign in to complete your purchase.");
      return;
    }
    var token = session.access_token;
    fetch(FN + "/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ bundle: bundle, return_url: window.location.origin + window.location.pathname })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) { window.location.href = d.url; }
        else { alert(d && d.error ? d.error : "Could not start checkout."); }
      })
      .catch(function () { alert("Could not reach checkout."); });
  };

  // "Restore purchases" — required by Apple for non-consumables
  // 1.14.82: the library shelf's "Download all for offline" needs the signed-in
  // token to ask library-url for each owned book. Read-only; null when signed out.
  window.twAccessToken = function () { return (session && session.access_token) || null; };
  window.twFnBase = FN;

  window.restorePurchases = function () {
    var plat = nativePlatform();
    if (!plat) { refreshEntitlements(); return; }
    initIAP().then(function (store) {
      if (store && store.restorePurchases) {
        store.restorePurchases().then(function () { setTimeout(refreshEntitlements, 1000); });
      } else { refreshEntitlements(); }
    });
  };

  // expose a manual refresh the shell can call
  window.refreshEntitlements = refreshEntitlements;
  // Expose the supabase client (loading it on demand) so the reader/codex can sign bucket URLs.
  window.getSb = function(){ return sb ? Promise.resolve(sb) : loadSupabase(); };

  // expose minimal auth surface for other features (e.g. Weave Pods) to make
  // authenticated edge-function calls without re-implementing login.
  window.twAuth = {
    fnBase: FN,
    token: function(){ return session ? session.access_token : null; },
    isLoggedIn: function(){ return !!session; },
    promptSignin: promptSignin
  };

  // --- adopt a session handed off from Joy Looper (same Supabase project) ---
  // Joy Looper opens us with #tw_session=<access>&tw_refresh=<refresh>. We set that
  // session so auth.uid() resolves to the member here, then strip the hash so the
  // tokens never linger in the address bar / history.
  function adoptHandoffSession() {
    try {
      var h = window.location.hash || "";
      if (h.indexOf("tw_session=") < 0) return Promise.resolve(false);
      var p = new URLSearchParams(h.replace(/^#/, ""));
      var at = p.get("tw_session"), rt = p.get("tw_refresh");
      if (!at) return Promise.resolve(false);
      return sb.auth.setSession({ access_token: at, refresh_token: rt || "" })
        .then(function () { return true; })
        .catch(function () { return false; })
        .then(function (ok) {
          // strip the tokens from the URL regardless of outcome
          try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) {}
          return ok;
        });
    } catch (e) { return Promise.resolve(false); }
  }

  // --- boot ---
  function boot() {
    loadSupabase().then(function () {
      return adoptHandoffSession();
    }).then(function () {
      return sb.auth.getSession();
    }).then(function (res) {
      session = res && res.data ? res.data.session : null;
      renderAccount();

      // Mark native early so the gating below can branch correctly.
      var _native = isNativeShell();
      if (_native) { try { document.body.classList.add("is-native"); } catch (e) {} }

      // WEB requires an account: signed out on the website => keep the full login wall
      // up and show NOTHING behind it. NATIVE (iOS/Android) must NOT gate -- Apple/Google
      // reject forced login -- so native always drops the wall.
      if (session || _native) {
        hideLoginWall();
        document.body.classList.remove("pre-auth");
      } else {
        document.body.classList.add("pre-auth");
        showLoginWall("Sign in to enter Thread Weaver.");
      }

      // Arrived from a password-reset link: /auth/confirm established the
      // session and sent us here with ?recovery=1.
      if (new URLSearchParams(window.location.search).get("recovery") === "1") {
        try { history.replaceState(null, "", window.location.pathname + window.location.search.replace(/[?&]recovery=1/, "").replace(/^&/, "?")); } catch (e) {}
        if (session) { showPasswordReset(); }
        else { showLoginWall("That reset link has expired. Request a new one below."); }
      }

      // returned from a successful Stripe checkout?
      var sp = new URLSearchParams(window.location.search);
      if (sp.get("purchase") === "success") {
        // The Stripe webhook writes the purchase row asynchronously. Two fixed
        // timers (1.5s and 5s) gave up before a cold start or a retry landed,
        // and the customer was dropped back on a shelf that still said locked.
        // Back off up to ~60s, stop as soon as a new grant appears.
        (function confirmPurchase() {
          var delays = [1000, 2000, 4000, 8000, 15000, 30000];
          var before = 0;
          try { before = Object.keys(JSON.parse(localStorage.getItem(UNLOCK_KEY) || "{}")).length; } catch (e) {}
          var i = 0;
          (function attempt() {
            refreshEntitlements().then(function () {
              var now = 0;
              try { now = Object.keys(JSON.parse(localStorage.getItem(UNLOCK_KEY) || "{}")).length; } catch (e) {}
              if (now > before) return;                 // it landed
              if (i >= delays.length) return;           // give up quietly; next load will pick it up
              setTimeout(attempt, delays[i++]);
            });
          })();
        })();
        // Don't let a refresh replay this forever.
        try {
          var _clean = window.location.pathname + window.location.search.replace(/[?&]purchase=success/, "").replace(/^&/, "?");
          history.replaceState(null, "", _clean);
        } catch (e) {}
      }

      if (session) { refreshEntitlements(); flushPendingIAP(); }

      // On native (iOS/Android), warm up the store so buy buttons are instant.
      if (nativePlatform()) {
        if (window.cordova) {
          document.addEventListener("deviceready", function () { initIAP(); }, false);
        } else { initIAP(); }
      }

      // react to auth changes (magic-link return fires this)
      sb.auth.onAuthStateChange(function (evt, s) {
        var hadSession = !!session;
        session = s;
        renderAccount();
        // Session lost without pressing Sign Out (expired refresh token, revoked
        // session). Without this the previous account's unlocks sit in
        // localStorage and merge into whoever signs in next on this device.
        if (!s && hadSession && evt !== "PASSWORD_RECOVERY") { clearServerGrants(); }
        if (evt === "PASSWORD_RECOVERY") {
          // The reset-email link lands here with a recovery session:
          // the password is NOT changed yet — show the set-new-password form.
          showPasswordReset();
          return;
        }
        // WEB re-gates on sign-out (full wall); NATIVE never gates.
        var _nat = isNativeShell();
        if (session || _nat) {
          hideLoginWall();
          document.body.classList.remove("pre-auth");
        } else {
          document.body.classList.add("pre-auth");
          showLoginWall("Sign in to enter Thread Weaver.");
        }
        if (session) { refreshEntitlements(); flushPendingIAP(); }
      });

    }).catch(function (e) {
      // Account is required, so if auth can't load we must NOT let people in.
      console.warn("store init failed", e);
      showLoginWall("Couldn't reach the sign-in service. Check your connection and reload.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
