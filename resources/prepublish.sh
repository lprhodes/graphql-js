# Because of a long-running npm issue (https://github.com/npm/npm/issues/3059)
# prepublish runs after `npm install` and `npm pack`.
# In order to only run prepublish before `npm publish`, we have to check argv.
if node -e "process.exit(($npm_config_argv).original[0].indexOf('pu') === 0)"; then
  exit 0;
fi

# Publishing to NPM is currently supported by Travis CI, which ensures that all
# tests pass first and the deployed module contains the correct file structure.
# In order to prevent inadvertently circumventing this, we ensure that a CI
# environment exists before continuing.

# When Travis CI publishes to NPM, the published files are available in the root
# directory, which allows for a clean include or require of sub-modules.
#
#    var language = require('graphql/language');
#
babel src --ignore __tests__ --out-dir ./;
