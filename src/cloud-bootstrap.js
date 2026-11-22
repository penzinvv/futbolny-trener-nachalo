/*
 * Cloud career bootstrap for returning players.
 * app.js loads league.json asynchronously; wait until it is available before
 * asking career-api to restore or initialize the signed-in coach's cloud data.
 */
(() => {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (
      typeof initializeCloudCareer === "function" &&
      typeof leagueData !== "undefined" &&
      leagueData &&
      typeof state !== "undefined"
    ) {
      window.clearInterval(timer);
      // Always initialize: a fresh browser may have no local career but a
      // signed-in account can still have a cloud snapshot to restore.
      void initializeCloudCareer();
      return;
    }
    if (attempts >= 100) window.clearInterval(timer);
  }, 100);
})();
