const packageVersion  = '0.0.1';

Package.describe({
  name:          'akasha:akasha-geth',
  version:       packageVersion,
  // Brief, one-line summary of the package.
  summary:       '',
  // URL to the Git repository containing the source code for this package.
  git:           '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});


Package.onUse(function (api) {
  api.versionsFrom('1.2.1');
  api.use('ecmascript');
  api.use('sanjo:long-running-child-process@1.1.3');
  api.use('akasha:fs-extra@0.26.2');
  api.use('akasha:request@2.67.0');
  api.use('akasha:shelljs@0.5.3');
  api.use('akasha:adm-zip@0.4.7');
  api.addFiles(['lib/geth.js'], 'server');
  api.export('GethConnector', 'server');
});
