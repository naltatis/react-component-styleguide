require("babel-register");
var path = require('path')
var fs = require('fs-extra')
var assign = require('object-assign')
var webpack = require('webpack')
var glob = require('glob')
var mustache = require('mustache')
var slash = require('slash')
var hmrServer = require('./hmr-server')
var DistStyleguidePlugin = require('./webpack-plugins/DistStyleguidePlugin')
var DocgenPlugin = require('./webpack-plugins/ReactDocgenPlugin')
var deepmerge = require('deepmerge')
var reactDocGenModule = require('react-docgen')

var autoprefixer = require('autoprefixer');
var cssnext = require('postcss-cssnext');
var postcssImport = require('postcss-import');

/**
 * React Styleguide Generator
 *
 * @class
 * @param {string} input
 * @param {Object} opts
 * @param {string} opts.output
 * @param {string} opts.title
 * @param {string|Object} opts.config
 * @param {string} opts.root
 * @param {boolean} opts.pushstate
 * @param {string[]} opts.files
 * @param {Object} opts.babelConfig
 * @param {Object} opts.webpackConfig
 * @param {Object} opts.reactDocgen
 */
function RCS (input, opts) {
  opts = opts || {}

  this.log = require('./logger')('rcs-lib', {debug: opts.verbose || false})

  var config

  // If feeding in a direct config object
  if (opts.config !== null && typeof opts.config === 'object') {
    config = opts.config
  } else {
    config = this.readConfig(opts.config)
  }

  opts = assign(config, opts)

  opts.output = path.resolve(process.cwd(), (opts.output || 'styleguide').replace(/\/+$/, ''))
  opts.title = opts.title || 'Style Guide'
  opts.root = opts.root ? path.normalize('/' + opts.root.replace(/\/+$/, '')) : null
  opts.pushstate = opts.pushstate || false
  opts.files = opts.files || []
  opts.babelConfig = opts.babelConfig || null
  opts.webpackConfig = opts.webpackConfig || {}
  // Run on port 3000 if mode enabled but port not specified
  if (opts.dev && opts.dev === true) {
    opts.dev = 3000
  } else if (!opts.dev) {
    opts.dev = false
  }

  this.input = glob
    .sync(input, {realpath: true})
    .filter(function (file) {
      var readFile = fs.readFileSync(file);
      try {
        if (reactDocGenModule.parse(readFile)) {
          return true
        }
      } catch (e) {
        return false
      }
    });

  opts['reactDocgen'] = opts['reactDocgen'] || {}

  if (!opts['reactDocgen'].files) {
    opts['reactDocgen'].files = [input]
  }

  this.opts = opts

  // files to parse for react-docgen
  this.reactDocGenFiles = this.getReactPropDocFiles()

  // Cached files to include into the styleguide app
  this.cssFiles = this.extractFiles('.css')
  this.jsFiles = this.extractFiles('.js')

  this.appTemplate = fs.readFileSync(path.resolve(__dirname, './fixtures/index.html.mustache'), 'utf-8')

  this.stageDir = path.resolve(__dirname, '../rcs-tmp')
}

RCS.prototype.cleanStageDir = function () {
  fs.ensureDirSync(this.stageDir)
  fs.removeSync(this.stageDir)
  fs.ensureDirSync(this.stageDir)
}

RCS.prototype.cleanOutDir = function () {
  fs.ensureDirSync(this.opts.output)
  fs.removeSync(this.opts.output)
  fs.ensureDirSync(this.opts.output)
}

RCS.prototype.sharedStart = function(array){
    var A= array.concat().sort(),
    a1= A[0], a2= A[A.length-1], L= a1.length, i= 0;
    while(i<L && a1.charAt(i)=== a2.charAt(i)) i++;
    return a1.substring(0, i);
}

/**
 * @param {string=} file
 * @returns {Object}
 */
RCS.prototype.readConfig = function (file) {
  file = file === undefined ? 'styleguide.json' : file

  if (!file) {
    return {}
  }

  var src = process.cwd() + '/' + file

  this.log.info({configFile: src}, 'Reading config file')

  try {
    if (fs.existsSync(src)) {
      return require(src)
    }
  } catch (e) {}

  return fs.existsSync(src) ? fs.readJsonSync(src) : {}
}

/**
 * Generates the files to process for react-docgen
 */
RCS.prototype.getReactPropDocFiles = function () {
  var files = this.opts['reactDocgen'].files
  var fileList = []

  files.forEach(function (file) {
    fileList = fileList.concat(glob
        .sync(file, {realpath: true})
        .filter(function (f) {
          var readFile = fs.readFileSync(f);
          try {
            if (reactDocGenModule.parse(readFile)) {
              return true
            }
          } catch (e) {
            return false
          }
        })
    )
  })

  // remove dupes
  return fileList.filter(function (elem, pos) {
    return fileList.indexOf(elem) === pos
  })
}

/**
 * @param {string} src
 * @param {string} dest
 * @returns {Promise}
 */
RCS.prototype.copy = function (src, dest) {
  return new Promise(function (resolve, reject) {
    fs.copy(src, dest, function (err) {
      if (err) {
        return reject(err)
      }
      resolve()
    })
  })
}

/**
 * @returns {Promise}
 */
RCS.prototype.copyOptsFiles = function () {
  var copy = this.copy
  var output = path.join(this.stageDir, 'dist/files/')

  var files = this.opts.files.filter(function (file) {
    return fs.existsSync(file)
  })

  return Promise.all(
    files.map(function (file) {
      var dest = path.join(output, path.basename(file))
      return copy(file, dest)
    })
  )
}

/**
 * @param {string} ext
 * @returns {string[]}
 */
RCS.prototype.extractFiles = function (ext) {
  return this.opts.files
    .filter(function (file) {
      return path.extname(file) === ext
    })
    .map(function (file) {
      // linter had issues with a ternary operator
      // resulting in 'Infix operators must be spaced'
      // unsure how it passed on master
      if (fs.existsSync(file)) {
        return ('files/' + path.basename(file))
      }

      return file
    })
}

/**
 * @returns {Promise}
 */
RCS.prototype.createHtmlFile = function () {
  var rootPath = this.opts.root ? slash(this.opts.root) : '';
  var data = assign({}, this.opts, {
    hashbang: this.opts.pushstate ? 'false' : 'true',
    cssFils: this.cssFiles,
    jsFils: this.jsFiles
  },{
    root: rootPath
  })

  var dest = path.join(this.stageDir, 'dist/index.html')
  var rendered = mustache.render(this.appTemplate, data)

  return new Promise(function (resolve, reject) {
    fs.outputFile(dest, rendered, function (err) {
      if (err) {
        return reject(err)
      }
      resolve()
    })
  })
}

/**
 * @returns {Promise}
 */
RCS.prototype.createContentsFile = function () {
  var self = this;

  var contentsInter = path.join(this.stageDir, '/component-requires.js');

  var data = this.input.map(function (file) {
    self.log.debug({file: file}, 'styleguide input file');
    return "require('" + slash(file) + "')"
  });

  data = 'module.exports = [' + data.join(',') + ']';
  fs.outputFileSync(contentsInter, data);

  function distContentsFile () {
    return new Promise(function (resolve, reject) {
      webpack(self.getWebpackConfig(), function (err, stats) {
        if (err) {
          return reject(err)
        }

        var jsonStats = stats.toJson()

        if (jsonStats.errors.length > 0) {
          return reject(jsonStats.errors)
        }

        if (jsonStats.warnings.length > 0) {
          self.log.warn(jsonStats.warnings)
        }
        resolve()
      })
    })
  }

  if (self.opts.dev) {
    hmrServer(self.getWebpackConfig(), self.opts.dev, self.log, path.join(self.stageDir, 'dist'), this.opts.root)
  } else {
    return distContentsFile()
  }
};

RCS.prototype.createRootPathFile = function () {
  var contentsInter = path.join(this.stageDir, '/root-path.js');
  var data = this.opts.root ? 'module.exports = "' + slash(this.opts.root) + '"' : 'module.exports = ' + this.opts.root;
  fs.outputFileSync(contentsInter, data);

};

RCS.prototype.getWebpackConfig = function () {
  var appDir = path.resolve(__dirname, '../app')
  var self = this

  var babelLoaderCfg = {
    loader: 'babel-loader',
    query: {
      presets: ['react', 'es2015', 'stage-0'],
      plugins: process.env.NODE_ENV === 'development' ? [
        ['react-transform',
          {
            'transforms': [
              {
                'transform': 'react-transform-hmr',
                'imports': ['react'],
                'locals': ['module']
              },
              {
                'transform': 'react-transform-catch-errors',
                'imports': ['react', 'redbox-react']
              }
            ]
          }
        ]
      ] : []
    }
  }
  var sharedDir = self.sharedStart(self.input);
  var loaders = [
    deepmerge({
      test: /\.jsx?$/,
      include: [sharedDir]
    }, babelLoaderCfg),
    deepmerge({
      // for when rcs is included in another project
      test: /\.jsx?$/,
      include: [appDir]
    }, babelLoaderCfg),
    {
      test: /\.css$/,
      loader: 'style-loader!css-loader!cssnext-loader',
      include: [appDir]
    },
    {
      test: /\.md$/,
      exclude: new RegExp(path.resolve(self.opts.output) + '|' + 'node_modules'),
      loader: 'raw-loader'
    }
  ]

  // custom rule for transpiling files
  this.opts.transpileIncludes && this.opts.transpileIncludes.forEach(function(rule) {
    loaders.push(deepmerge({
      test: /\.jsx?$/,
      include: rule
    }, babelLoaderCfg))
  });

  var rootPath = this.opts.root ? slash(path.join(this.opts.root, 'src/')) : '/src/';

  if (this.opts.webpackConfig && this.opts.webpackConfig.module && this.opts.webpackConfig.module.loaders){
    this.opts.webpackConfig.module.loaders = this.opts.webpackConfig.module.loaders.map((loader) => {
      loader.exclude = loader.exclude ? loader.exclude + ', ' + [appDir]:  [appDir];
      return loader;
    })
  }

  return deepmerge({
    entry: {
      app: [path.resolve(__dirname, '../app/index.js')].concat(self.opts.dev ? [
        'webpack-hot-middleware/client'
      ] : [])
    },
    devtool: 'eval',
    output: {
      path: path.join(self.stageDir, 'dist/src'),
      filename: 'bundle.js',
      publicPath: rootPath
    },
    node: {
      fs: 'empty'
    },
    plugins: [
      new webpack.optimize.CommonsChunkPlugin(
        'vendor',
        'vendor.bundle.js'
      ),
      new DocgenPlugin({
        files: self.reactDocGenFiles,
        stageDir: self.stageDir,
        log: self.log
      }),
      new webpack.optimize.OccurenceOrderPlugin()
    ].concat(process.env.NODE_ENV === 'production' ? [
      new webpack.DefinePlugin({
        'process.env': {
          'NODE_ENV': JSON.stringify('production')
        }
      }),
      new webpack.optimize.UglifyJsPlugin({
        compressor: {
          warnings: false
        }
      })
    ] : [
      new webpack.HotModuleReplacementPlugin(),
      new webpack.NoErrorsPlugin()
    ]).concat(!self.opts.dev ? [
      // Distribute out assets to out dir only in non-dev mode
      new DistStyleguidePlugin({
        outDir: self.opts.output,
        stageDir: self.stageDir,
        log: self.log
      })
    ] : []),
    module: {
      loaders: loaders
    }
  }, this.opts.webpackConfig, { arrays: 'concat' })
}

/**
 * @param {Function=} cb
 * @returns {Promise}
 */
RCS.prototype.generate = function (cb) {
  var self = this
  cb = cb ? cb.bind(this) : function () {
  }

  this.cleanStageDir()

  return Promise
    .all([
      this.copyOptsFiles(),
      this.createHtmlFile()
    ])
    .then(function () {
      return self.createContentsFile()
    })
    .then(function () {
      return self.createRootPathFile()
    })
    .then(function () {
      if (!self.opts.dev) {
        fs.removeSync(self.stageDir)
      }
      cb()
    })
    .catch(function (err) {
      this.log.error(err)
      cb(err)
    }.bind(this))
}

module.exports = function (input, opts) {
  return new RCS(input, opts)
}
