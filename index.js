if (typeof XMLHttpRequest == 'undefined') {
	XMLHttpRequest = function () {
		try {
			return new ActiveXObject('Msxml2.XMLHTTP.6.0');
		} catch (e) {}
		try {
			return new ActiveXObject('Msxml2.XMLHTTP.3.0');
		} catch (e) {}
		try {
			return new ActiveXObject('Microsoft.XMLHTTP');
		} catch (e) {}
		
		// Microsoft.XMLHTTP points to Msxml2.XMLHTTP and is redundant
		throw new Error('This browser does not support XMLHttpRequest.');
	};
}

var querify = function(query) {
	var result = '';

	for (var i in query) {
		result += i+'='+encodeURIComponent(query[i]);
	}
	return result;
};
var noop = function() {};

var requests = 0;
var active = {};
var pool = [];

window.onunload = function() {
	for (var i in active) {
		active[i].abort();
	}
};

var Request = function(method, url) {
	url = url.split('?');

	this._method = method;
	this._url = url[0];
	this._query = url[1] || '';
};

Request.prototype.timeout = function(ms, callback) {
	var self = this;

	this._timeout = setTimeout(function() {
		self.destroy();
	}, ms);

	return this._short(callback);
};
Request.prototype.destroy = noop;
Request.prototype.query = function(query, callback) {
	this._query = querify(query);
	this._query = (this._query && '?') + this._query;
	return this._short(callback);
};
Request.prototype.form = function(data, callback) {
	this._encode = querify;
	return this._short(data, callback);
};
Request.prototype.json = function(json, callback) {
	this._encode = function(data) {
		return JSON.stringify(data);
	};
	this._decode = function(data) {
		return JSON.parse(data);	
	};
	return this._short(json, callback);
};
Request.prototype.send = function(data, callback) {
	if (!callback) {
		callback = data;
		data = null;
	} else {
		data = this._encode(data);				
	}

	var self = this;
	var xhr = pool.length ? pool.pop() : new XMLHttpRequest();

	var id = ''+(++requests);			

	active[id] = xhr;
	
	var tidy = function() {
		delete active[id];
		xhr.onreadystatechange = noop;		
	};
	var onresponse = function() {
		pool.push(xhr);

		if (self._timeout) {
			clearTimeout(self._timeout);
		}
		if (!/2\d\d/.test(xhr.status)) {
			callback(new Error('invalid status='+xhr.status));
			return
		}
		var response;

		try {
			response = self._decode(xhr.responseText);
		} catch(err) {
			callback(err);
			return;
		}
		callback(null, response);
	};

	xhr.open(this._method, this._url+this._query, true);
	xhr.onreadystatechange = function() {
		if (xhr.readyState !== 4) {
			return;
		}
		tidy();
		setTimeout(onresponse, 1); // push it to the event stack
	};
	xhr.send(data);
	
	this.destroy = function() {
		tidy();
		xhr.abort();
		callback(new Error('request aborted'));
	};

	return this;
};
Request.prototype._short = function(a,b) {
	return a ? this.send(a,b) : this;
};
Request.prototype._encode = function(data) {
	return ''+data;
};
Request.prototype._decode = function(data) {
	return data;
};

var prefix = (new Date()).getTime().toString(36);
var globalScope = window._tmp_jsonp = {}; // A global variable to reference jsonp closures
var cnt = 0;

var JSONP = function(url) {
	url = url.split('?');

	this._url = url[0];
	this._query = url.slice(1).join('?') || '';
};

JSONP.prototype.timeout = Request.prototype.timeout; // exactly the same
JSONP.prototype.query = Request.prototype.query; // exactly the same

JSONP.prototype.strict = function(callback) {
	this._strict = true;
	return this._short(callback);	
};
JSONP.prototype.send = function(method, callback) {
	if (!callback && typeof method !== 'string') {
		callback = method;
		method = 'callback';
	}
	callback = callback || noop;

	var self = this;
	var match = this._query.match(/(^|&)([^=])+=\?/);
	var id = 'cb'+prefix+(cnt++).toString(36);
	var callbackId = '_tmp_jsonp.'+id;
	var ended = false;

	if (match) {
		this._query = this._query.replace(match[2]+'=?', match[2]+'='+callbackId);
	} else {
		this._query += (this._query ? '&' : '?') + method+'='+callbackId;
	}

	var url = this._url + this._query;

	var onresult = function(err, result) {
		ended = true;

		var el = document.getElementById(id);
		
		if (el) {
			el.onreadystatechange = noop;
			el.parentNode.removeChild(el);
		}
		el = null; // no mem leaks

		delete globalScope[id];

		self.destroy = noop;

		callback(err, result);
	};

	globalScope[id] = function(result) {
		if (self._strict && (result === undefined || result === null || result.error)) {
			var err = new Error((result && result.error) || 'result is undefined or null');
			
			if (result) {
				for (var i in result) {
					err[i] = result[i];
				}
			}
			onresult(err);
			return;
		}
		onresult(null, result);
	};

	if (document.body) {
		var el = document.createElement('script');

		el.async = true;
		el.src = url;
		el.id = id;

		document.body.appendChild(el);
		el = null; // no leaks
	} else {
		document.write(unescape('%3Cscript')+' src="'+url+'" id="'+id+'"'+unescape('%3E%3C/script%3E'));
	}

	document.getElementById(id).onreadystatechange = function() {
		if (ended || (this.readyState !== 'loaded' && this.readyState !== 'complete')) {
			return;
		}
		onresult(new Error('jsonp request failed'));								
	};
	
	this.destroy = function() {
		onresult(new Error('jsonp request was cancelled'));
	};

	return this;
};
JSONP.prototype.destroy = noop;

JSONP.prototype._short = Request.prototype._short; // exactly the same


var methods = {'POST':0, 'GET':0, 'DELETE':'del', 'PUT':0};

var define = function(method) {
	return function(url, callback) {
		var req = new Request(method, url);

		if (callback) {
			req.send(callback);
		}

		return req;
	};
};

exports.cors = ('withCredentials' in new XMLHttpRequest());

exports.jsonp = function(url, callback) {
	var req = new JSONP(url);

	if (callback) {
		req.send(callback);
	}
	return req;
};

for (var method in methods) {
	exports[(methods[method] || method).toLowerCase()] = define(method);
}