const { withXcodeProject } = require('expo/config-plugins');

function applyIosSigning(project, team) {
  if (!team) return project;
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid iOS development team.');
  // Include app extensions; the Expo app-target helper sets only the main target.
  project.addBuildProperty('DEVELOPMENT_TEAM', team);
  return project;
}

module.exports = (config) => withXcodeProject(config, (mod) => {
  mod.modResults = applyIosSigning(mod.modResults, mod.ios?.appleTeamId);
  return mod;
});
module.exports.applyIosSigning = applyIosSigning;
