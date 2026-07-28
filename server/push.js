const webpush = require("web-push");

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:you@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn(
    "VAPID keys are not set - push notifications are disabled until you add them to .env (run `npm run generate-vapid`)."
  );
}

module.exports = webpush;
