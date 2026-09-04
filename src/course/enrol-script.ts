// The course page's inline script (spec §2). Plain ES2017 in a string —
// the page is static HTML on Pages with no build step — kept tiny and
// touching only a handful of DOM calls so tests/course-join-page.test.ts can
// run it against a fake document. Its storage key and shape are the same
// as src/learn.ts's (LEARNERS_KEY, {code, api, name}) because the player
// on drawcast.app reads what this page wrote when both share an origin.
//
// It duplicates src/learn.ts's storage key/shape, code normalisation and
// ?learner= parsing in ES5 rather than importing it — this is a static
// page with no bundler, so there is nothing to import from.

export const ENROL_SCRIPT = String.raw`(function () {
  var box = document.querySelector(".join");
  if (!box) return;
  var api = (box.getAttribute("data-enroll") || "").replace(/\/+$/, "");
  var course = box.getAttribute("data-course") || "";
  var KEY = "drawcast.learners";
  var CODE_RE = /^[a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7}$/;
  function $(id) { return document.getElementById(id); }
  function store() { try { return localStorage; } catch (e) { return null; } }
  function read() { var s = store(); if (!s) return {}; try { var v = JSON.parse(s.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function write(map) { var s = store(); if (!s) return; try { s.setItem(KEY, JSON.stringify(map)); } catch (e) {} }
  function entry() { var e = read()[course]; return e && typeof e.code === "string" ? e : null; }
  function save(code, name) { var m = read(); m[course] = { code: code, api: api, name: name || null }; write(m); }
  function forget() { var m = read(); delete m[course]; write(m); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function normalize(raw) { var s = String(raw || "").trim().toLowerCase().split(/\s+/).join("-"); return CODE_RE.test(s) ? s : null; }
  function post(path, body) {
    return fetch(api + "/_/api/" + path, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }, function () { return { ok: r.ok, body: {} }; }); });
  }
  function pageUrl() { return location.origin + location.pathname; }
  function runSlug() { var m = /[?&]run=([^&#]+)/.exec(location.search || ""); return m ? decodeURIComponent(m[1]) : null; }

  var arriving = /[?&]learner=([^&#]+)/.exec(location.search || "");
  if (arriving) {
    var code = normalize(decodeURIComponent(arriving[1]));
    if (code) save(code, (entry() || {}).name);
    try { history.replaceState(null, "", location.pathname + (location.hash || "")); } catch (e) {}
  }

  // Ruling A: data-cast lives on both the <li> and its <a> (spec markup),
  // so link rewriting and progress marks use distinct selectors — rewriting
  // "[data-cast]" as a whole would also clobber the anchor's innerHTML.
  var anchors = document.querySelectorAll("a[data-cast]");
  var lis = document.querySelectorAll("li[data-cast]");
  function rewriteLinks(code) {
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute("href");
      if (href == null) continue;
      href = href.replace(/&learner=[^&]*/, "");
      a.setAttribute("href", href + "&learner=" + code);
    }
  }
  function mark(lecture) {
    var right = 0, total = lecture.answers.length;
    for (var i = 0; i < total; i++) if (lecture.answers[i].correct) right++;
    var sym = lecture.completed ? "✓" : lecture.opened ? "○" : "·";
    return { label: total ? sym + " " + right + "/" + total : sym, right: right, total: total };
  }
  function answersHtml(lecture) {
    var out = "<ol class=\"answers\">";
    for (var i = 0; i < lecture.answers.length; i++) {
      var a = lecture.answers[i];
      var given = a.given && a.given.length ? a.given.join(" → ") : "(skipped)";
      out += "<li>" + (a.correct ? "✓" : "✗") + " <b>" + esc(a.question) + "</b><br>you: " + esc(given) + "<br>expected: " + esc(a.expected) + "</li>";
    }
    return out + "</ol>";
  }
  function showProgress(e) {
    fetch(api + "/_/api/progress?code=" + encodeURIComponent(e.code)).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
      if (!p || !p.lectures) { $("join-progress-note").textContent = "Progress is unavailable right now."; return; }
      var byCast = {};
      for (var i = 0; i < p.lectures.length; i++) byCast[p.lectures[i].cast] = p.lectures[i];
      for (var j = 0; j < lis.length; j++) {
        var li = lis[j], lecture = byCast[li.getAttribute("data-cast")];
        if (!lecture) continue;
        var m = mark(lecture);
        li.innerHTML = "<span class=\"mark\" title=\"click for your answers\">" + esc(m.label) + "</span>" + li.innerHTML + (m.total ? "<div class=\"review\" hidden>" + answersHtml(lecture) + "</div>" : "");
      }
      $("join-progress-note").textContent = "✓ completed · ○ opened · click a score to review your answers";
    }, function () { $("join-progress-note").textContent = "Progress is unavailable right now."; });
  }
  function render() {
    var e = entry();
    $("join-form").hidden = !!e;
    $("join-you").hidden = !e;
    $("join-switch-box").hidden = true;
    if (e) {
      $("join-code").textContent = e.code;
      rewriteLinks(e.code);
      showProgress(e);
    }
  }

  $("join-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    $("join-status").textContent = "Joining…";
    var name = ($("join-name").value || "").trim() || null;
    var email = ($("join-email").value || "").trim() || null;
    var title = box.getAttribute("data-title") || course;
    post("enroll", { course: course, title: title, page: pageUrl(), run: runSlug(), name: name, email: email }).then(function (r) {
      if (!r.ok) {
        $("join-status").textContent = r.body && r.body.error === "email" ? "This course needs an email address." : r.body && r.body.error === "closed" ? "This course is not open for enrolment." : "Could not join — please try again.";
        return;
      }
      if (r.body.resent) { $("join-status").textContent = "You are already enrolled — we sent your code to your email again."; return; }
      save(r.body.code, name);
      $("join-status").textContent = r.body.email_sent ? "Your course code is below. We sent it to you as well." : "Your course code is below. Write it down — it is your only key.";
      render();
    }, function () { $("join-status").textContent = "Could not join — please try again."; });
  });
  $("join-forget").addEventListener("click", function (ev) {
    ev.preventDefault();
    var e = entry();
    if (!e) return;
    post("forget", { code: e.code }).then(function () { forget(); $("join-status").textContent = "Forgotten. Your data has been deleted."; render(); }, function () { $("join-status").textContent = "Could not reach the server — try again."; });
  });
  $("join-switch").addEventListener("click", function (ev) { ev.preventDefault(); $("join-switch-box").hidden = false; });
  $("join-switch-button").addEventListener("click", function (ev) {
    ev.preventDefault();
    var code = normalize($("join-switch-input").value);
    if (!code) { $("join-status").textContent = "That is not a course code (three words, like fjell-rev-havn)."; return; }
    save(code, null);
    $("join-status").textContent = "";
    render();
  });
  document.addEventListener && document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || !t.classList || !t.classList.contains("mark")) return;
    var li = t.parentNode, review = li && li.querySelector && li.querySelector(".review");
    if (review) review.hidden = !review.hidden;
  });
  render();
})();`;
