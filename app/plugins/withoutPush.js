// Personal (free) Apple teams can't use the Push Notifications capability, which
// expo-notifications adds via the aps-environment entitlement. We only use
// local notification permissions (no remote push), so strip it after prebuild.
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withoutPush(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
