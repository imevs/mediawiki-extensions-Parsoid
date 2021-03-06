"use strict";

var Util = require('./mediawiki.Util.js').Util;

/**
 * @class
 *
 * Represents a title in a wiki.
 *
 * @constructor
 * @param {string} key The text of the title
 * @param {number} ns The id of the namespace where the page is
 * @param {string} nskey The text of the namespace name
 * @param {MWParserEnvironment} env
 */
function Title ( key, ns, nskey, env ) {
	this.key = env.resolveTitle( key );

	this.ns = new Namespace( ns, env );

	// the original ns string
	this.nskey = nskey;
	this.env = env;
}

/**
 * @method
 * @static
 *
 * Take text, e.g. from a wikilink, and make a Title object from it.
 *
 * @param {MWParserEnvironment} env
 * @param {string} text The prefixed text.
 * @returns {Title}
 */
Title.fromPrefixedText = function ( env, text ) {
	text = env.normalizeTitle( text );
	var nsText = text.split( ':', 1 )[0];
	if ( nsText && nsText !== text ) {
		var _ns = new Namespace( 0, env );
		var ns = _ns.namespaceIds[ nsText.toLowerCase().replace( ' ', '_' ) ];
		//console.warn( JSON.stringify( [ nsText, ns ] ) );
		if ( ns !== undefined ) {
			return new Title( text.substr( nsText.length + 1 ), ns, nsText, env );
		} else {
			return new Title( text, 0, '', env );
		}
	} else {
		return new Title( text, 0, '', env );
	}
};

/**
 * @method
 *
 * Make a full link out of a title.
 *
 * @returns {string}
 */
Title.prototype.makeLink = function () {
	// XXX: links always point to the canonical namespace name.
	if ( false && this.nskey ) {
		return Util.sanitizeTitleURI( this.env.page.relativeLinkPrefix +
				this.nskey + ':' + this.key );
	} else {
		var l = this.env.page.relativeLinkPrefix,
			ns = this.ns.getDefaultName();

		if ( ns ) {
			l += ns + ':';
		}
		return Util.sanitizeTitleURI( l + this.key );
	}
};

/**
 * @method
 *
 * Get the text of the title, like you might see in a wikilink.
 *
 * @returns {string}
 */
Title.prototype.getPrefixedText = function () {
	// XXX: links always point to the canonical namespace name.
	if ( this.nskey ) {
		return Util.sanitizeURI( this.nskey + ':' + this.key );
	} else {
		var ns = this.ns.getDefaultName();

		if ( ns ) {
			ns += ':';
		}
		return Util.sanitizeTitleURI( ns + this.key );
	}
};

/**
 * @class
 *
 * Represents a namespace, meant for use in the #Title class.
 *
 * @constructor
 * @param {number} id The id of the namespace to represent.
 * @param {MWParserEnvironment} env
 */
function Namespace( id, env ) {
	var ids = env.conf.wiki.namespaceIds;
	var names = env.conf.wiki.namespaceNames;
	this.id = Number( id );
	this.namespaceIds = env.conf.wiki.canonicalNamespaces;
	this.canonicalNamespaces = env.conf.wiki.canonicalNamespaces;

	if ( ids ) {
		for ( var ix in ids ) {
		if ( ids.hasOwnProperty( ix ) ) {
			this.namespaceIds[ix.toLowerCase()] = ids[ix];
			}
		}
	}

	this.namespaceNames = ( names ) ? names : {
		'6': 'File',
		'-2': 'Media',
		'-1': 'Special',
		'0': '',
		'14': 'Category'
	};
}

/**
 * @method
 *
 * Determine whether the namespace is the File namespace.
 *
 * @returns {boolean}
 */
Namespace.prototype.isFile = function ( ) {
	return this.id === this.canonicalNamespaces.file;
};

/**
 * @method
 *
 * Determine whether the namespace is the Category namespace.
 *
 * @returns {boolean}
 */
Namespace.prototype.isCategory = function ( ) {
	return this.id === this.canonicalNamespaces.category;
};

/**
 * @method
 *
 * Determine the default name of the namespace.
 *
 * @returns {string/undefined}
 */
Namespace.prototype.getDefaultName = function ( ) {
	return this.namespaceNames[this.id.toString()];
};

if (typeof module === "object") {
	module.exports.Title = Title;
	module.exports.Namespace = Namespace;
}
