"use strict";

var request = require('request'),
	$ = require( './fakejquery' ),
	qs = require('querystring'),
	events = require('events'),
	util = require('util');

/**
 * @class
 * @extends Error
 */
function DoesNotExistError( message ) {
    this.name = "DoesNotExistError";
    this.message = message || "Something doesn't exist";
    this.code = 404;
}
DoesNotExistError.prototype = Error.prototype;

/**
 * @class
 * @extends Error
 */
function ParserError( message ) {
    this.name = "ParserError";
    this.message = message || "Generic parser error";
    this.code = 500;
}
ParserError.prototype = Error.prototype;

/**
 * @class
 * @extends Error
 */
function AccessDeniedError( message ) {
	this.name = 'AccessDeniedError';
	this.message = message || 'Your wiki requires a logged-in account to access the API. Parsoid will not work for this wiki!';
	this.code = 401;
}
AccessDeniedError.prototype = Error.prototype;

/**
 *
 * Abstract API request base class
 *
 * @class
 * @extends EventEmitter
 *
 * @constructor
 * @param {MWParserEnvironment} env
 * @param {string} title The title of the page we should fetch from the API
 */
function ApiRequest ( env, title ) {
	// call the EventEmitter constructor
	events.EventEmitter.call(this);

	// Increase the number of maximum listeners a bit..
	this.setMaxListeners( 50000 );
	this.retries = 5;
	this.env = env;
	this.title = title;
	this.reqType = "Page Fetch";
}

// Inherit from EventEmitter
util.inherits(ApiRequest, events.EventEmitter);

/**
 * @method
 * @private
 * @param {Error/null} error
 * @param {string} src The wikitext source of the page
 */
ApiRequest.prototype._processListeners = function ( error, src ) {
	// Process only a few callbacks in each event loop iteration to
	// reduce memory usage.
	var listeners = this.listeners( 'src' );

	var processSome = function () {
		// XXX: experiment a bit with the number of callbacks per
		// iteration!
		var maxIters = Math.min(1, listeners.length);
		for ( var it = 0; it < maxIters; it++ ) {
			var nextListener = listeners.shift();
			// We only retrieve text/x-mediawiki source currently.
			nextListener( error || null, src, 'text/x-mediawiki' );
		}
		if ( listeners.length ) {
			process.nextTick( processSome );
		}
	};

	process.nextTick( processSome );
};

/**
 * @method
 * @private
 * @param {Error/null} error
 * @param {Object} response The API response object, with error code
 * @param {string} body The body of the response from the API
 */
ApiRequest.prototype._requestCB = function (error, response, body) {
	//console.warn( 'response for ' + title + ' :' + body + ':' );
	var self = this;

	if(error) {
		this.env.tp('WARNING: RETRY:', error, this.queueKey);
		if ( this.retries ) {
			this.retries--;
			this.env.tp( 'Retrying ' + this.reqType + ' request for ' + this.title + ', ' +
					this.retries + ' remaining' );
			// retry
			request( this.requestOptions, this._requestCB.bind(this) );
			return;
		} else {
			var dnee = new DoesNotExistError( this.reqType + ' failure for ' + this.title );
			//this.emit('src', dnee, dnee.toString(), 'text/x-mediawiki');
			this._handleJSON( dnee, {} );
		}
	} else if (response.statusCode === 200) {
		var src = '', data;
		try {
			//console.warn( 'body: ' + body );
			data = JSON.parse( body );
		} catch(e) {
			error = new ParserError( 'Failed to parse the JSON response for ' + this.reqType + " " + self.title );
		}
		this._handleJSON( error, data );
	} else {
		console.log( body );
		console.warn( 'non-200 response: ' + response.statusCode );
		error = new DoesNotExistError( this.reqType + ' failure for ' + this.title );
		this._handleJSON( error, {} );
	}

	// XXX: handle other status codes

	// Remove self from request queue
	//this.env.dp( 'trying to remove ', this.title, ' from requestQueue' );

	delete this.env.requestQueue[this.queueKey];
	//this.env.dp( 'after deletion:', this.env.requestQueue );
};

/**
 * @method _handleJSON
 * @template
 * @private
 * @param {Error} error
 * @param {Object} data The response from the server - parsed JSON object
 */

/**
 * @class
 * @extends ApiRequest
 *
 * Template fetch request helper class
 *
 * @constructor
 * @param {MWParserEnvironment} env
 * @param {string} title The template (or really, page) we should fetch from the wiki
 * @param {string} oldid The revision ID you want to get, defaults to "latest revision"
 */

function TemplateRequest ( env, title, oldid ) {
	// Construct ApiRequest;
	ApiRequest.call(this, env, title);

	this.queueKey = title;
	this.reqType = "Template Fetch";

	var apiargs = {
		format: 'json',
		action: 'query',
		prop: 'revisions',
		rvprop: 'content',
		titles: title
	};
	if ( oldid ) {
		this.oldid = oldid;
		apiargs.revids = oldid;
		delete apiargs.titles;
	}
	var url = env.conf.parsoid.apiURI + '?' +
		qs.stringify( apiargs );
		//'?format=json&action=query&prop=revisions&rvprop=content&titles=' + title;

	this.requestOptions = {
		method: 'GET',
		followRedirect: true,
		url: url,
		timeout: 40 * 1000, // 40 seconds
		headers: {
			'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:9.0.1) ' +
							'Gecko/20100101 Firefox/9.0.1 Iceweasel/9.0.1',
			'Connection': 'close'

		}
	};

	// Start the request
	request( this.requestOptions, this._requestCB.bind(this) );
}

// Inherit from ApiRequest
util.inherits(TemplateRequest, ApiRequest);

/**
 * @inheritdoc ApiRequest#_handleJSON
 */
TemplateRequest.prototype._handleJSON = function ( error, data ) {
	var regex, title, err, location, iwstr, interwiki, src = '',
		self = this;

	if ( error ) {
		this._processListeners( error, '' );
		return;
	}

	if ( !data.query.pages ) {
		if ( data.query.interwiki ) {
			// Essentially redirect, but don't actually redirect.
			interwiki = data.query.interwiki[0];
			title = interwiki.title;
			regex = new RegExp( '^' + interwiki.iw + ':' );
			title = title.replace( regex, '' );
			iwstr = this.env.conf.wiki.interwikiMap[interwiki.iw].url ||
				this.env.conf.parsoid.interwikiMap[interwiki.iw].url || '/' + interwiki.iw + '/' + '$1';
			location = iwstr.replace( '$1', title );
			err = new DoesNotExistError( 'The page at ' +
					self.title +
					' can be found at a different location: '
					+ location );
			this._processListeners( err, '' );
			return;
		}
		console.log( data );
		error = new DoesNotExistError(
			'No pages were returned from the API request for ' +
			self.title
		);
	} else {
		try {
			$.each( data.query.pages, function(i, page) {
				if (page.revisions && page.revisions.length) {
					src = page.revisions[0]['*'];
				} else {
					throw new DoesNotExistError( 'Did not find page revisions for ' + self.title );
				}
			});
		} catch ( e2 ) {
			if ( e2 instanceof DoesNotExistError ) {
				error = e2;
			} else {
				error = new DoesNotExistError(
						'Did not find page revisions in the returned body for ' +
						self.title );
			}
		}
	}

	// check for #REDIRECT
	var redirMatch = src.match( /[\r\n\s]*#\s*redirect\s*\[\[([^\]]+)\]\]/i );
	if ( redirMatch ) {
		var title = redirMatch[1],
			url = this.env.conf.parsoid.apiURI + '?' +
				qs.stringify( {
					format: 'json',
				action: 'query',
				prop: 'revisions',
				rvprop: 'content',
				titles: title
				} );
		//'?format=json&action=query&prop=revisions&rvprop=content&titles=' + title;
		this.requestOptions.url = url;
		request( this.requestOptions, this._requestCB.bind(this) );
		return;
	}

	//console.warn( 'Page ' + title + ': got ' + src );
	this.env.tp( 'Retrieved ' + this.title, src );

	// Add the source to the cache
	this.env.pageCache[this.title] = src;

	this._processListeners( error, src );
};

/**
 * @class
 * @extends ApiRequest
 *
 * Passes the source of a single preprocessor construct including its
 * parameters to action=expandtemplates
 *
 * @constructor
 * @param {MWParserEnvironment} env
 * @param {string} title The title of the page to use as the context
 * @param {string} text
 */
function PreprocessorRequest ( env, title, text ) {
	ApiRequest.call(this, env, title);

	this.text = text;
	this.queueKey = text;
	this.reqType = "Template Expansion";

	var apiargs = {
		format: 'json',
		action: 'expandtemplates',
		title: title,
		text: text
	};
	var url = env.conf.parsoid.apiURI;

	this.requestOptions = {
		// Use POST since we are passing a bit of source, and GET has a very
		// limited length. You'll be greeted by "HTTP Error 414 Request URI
		// too long" otherwise ;)
		method: 'POST',
		form: apiargs, // The API arguments
		followRedirect: true,
		url: url,
		timeout: 16 * 1000, // 16 seconds
		headers: {
			'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:9.0.1) ' +
							'Gecko/20100101 Firefox/9.0.1 Iceweasel/9.0.1',
			'Connection': 'close'
		}
	};

	// Start the request
	request( this.requestOptions, this._requestCB.bind(this) );
}


// Inherit from ApiRequest
//PreprocessorRequest.prototype = new ApiRequest();
//PreprocessorRequest.prototype.constructor = PreprocessorRequest;
util.inherits( PreprocessorRequest, ApiRequest );

/**
 * @inheritdoc ApiRequest#_handleJSON
 */
PreprocessorRequest.prototype._handleJSON = function ( error, data ) {
	if ( error ) {
		this._processListeners( error, '' );
		return;
	}

	var src = '';
	try {
		src = data.expandtemplates['*'];

		//console.warn( 'Page ' + title + ': got ' + src );
		this.env.tp( 'Expanded ', this.text, src );

		// Add the source to the cache
		this.env.pageCache[this.text] = src;
	} catch ( e2 ) {
		error = new DoesNotExistError( 'Did not find page revisions in the returned body for ' +
				this.title + e2 );
	}


	//console.log( this.listeners('src') );
	this._processListeners( error, src );
};

/**
 * @class
 * @extends ApiRequest
 *
 * Gets the PHP parser to parse content for us.
 * Used for handling extension content right now.
 * And, probably magic words later on.
 *
 * @constructor
 * @param {MWParserEnvironment} env
 * @param {string} title The title of the page to use as context
 * @param {string} text
 */
function PHPParseRequest ( env, title, text ) {
	ApiRequest.call(this, env, title);

	this.text = text;
	this.queueKey = text;
	this.reqType = "Extension Parse";

	var apiargs = {
		format: 'json',
		action: 'parse',
		text: text
	};
	var url = env.conf.parsoid.apiURI;

	this.requestOptions = {
		// Use POST since we are passing a bit of source, and GET has a very
		// limited length. You'll be greeted by "HTTP Error 414 Request URI
		// too long" otherwise ;)
		method: 'POST',
		form: apiargs, // The API arguments
		followRedirect: true,
		url: url,
		timeout: 16 * 1000, // 16 seconds
		headers: {
			'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:9.0.1) ' +
							'Gecko/20100101 Firefox/9.0.1 Iceweasel/9.0.1',
			'Connection': 'close'
		}
	};

	// Start the request
	request( this.requestOptions, this._requestCB.bind(this) );
}

// Inherit from ApiRequest
util.inherits( PHPParseRequest, ApiRequest );

/**
 * @inheritdoc ApiRequest#_handleJSON
 */
PHPParseRequest.prototype._handleJSON = function ( error, data ) {
	if ( error ) {
		this._processListeners( error, '' );
		return;
	}

	var parsedHtml = '';
	try {
		// Strip php parse stats from the html
		parsedHtml = data.parse.text['*'].replace(/(^<p>)|((<\/p>)?\s*<!--\s*NewPP limit(\n|.)*$)/g, '');
		this.env.tp( 'Expanded ', this.text, parsedHtml );

		// Add the source to the cache
		this.env.pageCache[this.text] = parsedHtml;
	} catch ( e2 ) {
		error = new DoesNotExistError( 'Could not expand extension content for ' +
				this.title + e2 );
	}

	//console.log( this.listeners('parsedHtml') );
	this._processListeners( error, parsedHtml );
};

/**
 * @class
 * @extends ApiRequest
 *
 * A request for the wiki's configuration variables.
 *
 * @constructor
 * @param {string} confSource The API URI to use for fetching, or a filename
 * @param {MWParserEnvironment} env
 */
var ConfigRequest = function ( confSource, env ) {
	ApiRequest.call( this, env, null );

	if ( !env.conf.parsoid.fetchConfig ) {
		// Hack! Configured to use local configurations, probably for
		// parserTests. Fetch the cached versions and use those.
		// The confSource will be a filename in this case.
		var localConf = require( confSource );
		this._handleJSON( null, localConf );
		return;
	}

	var metas = [
			'siteinfo'
		],

		siprops = [
			'namespaces',
			'namespacealiases',
			'magicwords',
			'extensiontags',
			'general',
			'interwikimap',
			'languages',
			'protocols'
		],

		apiargs = {
			format: 'json',
			action: 'query',
			meta: metas.join( '|' ),
			siprop: siprops.join( '|' )
		};

	if ( !confSource ) {
		this._requestCB( new Error( 'There was no base URI for the API we tried to use.' ) );
		return;
	}

	var url = confSource + '?' +
		qs.stringify( apiargs );

	this.requestOptions = {
		method: 'GET',
		followRedirect: true,
		url: url,
		timeout: 40 * 1000,
		headers: {
			'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:9.0.1) ' +
				'Gecko/20100101 Firefox/9.0.1 Iceweasel/9.0.1',
			'Connection': 'close'
		}
	};

	request( this.requestOptions, this._requestCB.bind( this ) );
};

util.inherits( ConfigRequest, ApiRequest );

/**
 * @inheritdoc ApiRequest#_handleJSON
 */
ConfigRequest.prototype._handleJSON = function ( error, data ) {
	if ( error ) {
		this._processListeners( error, {} );
		return;
	}

	if ( data && data.query ) {
		this._processListeners( null, data.query );
	} else if ( data && data.error ) {
		if ( data.error.code === 'readapidenied' ) {
			error = new AccessDeniedError();
		} else {
			error = new Error( 'Something happened on the API side. Message: ' + data.error.code + ': ' + data.error.info );
		}
		this._processListeners( error, {} );
	} else {
		this._processListeners( null, {} );
	}
};

if (typeof module === "object") {
	module.exports.ConfigRequest = ConfigRequest;
	module.exports.TemplateRequest = TemplateRequest;
	module.exports.PreprocessorRequest= PreprocessorRequest;
	module.exports.PHPParseRequest = PHPParseRequest;
	module.exports.DoesNotExistError = DoesNotExistError;
	module.exports.ParserError = ParserError;
}
