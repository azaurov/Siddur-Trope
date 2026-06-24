const base = require("./app.json");

module.exports = ({ config }) => ({
  ...base.expo,
  experiments: {
    ...(base.expo.experiments || {}),
    baseUrl: process.env.EXPO_BASE_URL || "",
  },
});
