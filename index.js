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
var noop = function() {};

var prefix = (new Date()).getTime().toString(36);
var cache = {};
var globalScope = window._tmp_jsonp = {}; // A global variable to reference jsonp closures
var cnt = 0;
var active = {};
var pool = [];

window.onunload = function() {
	for (var i in active) {
		active[i].abort();
	}
};

var addEvent = function(name, fn) {
	if (window.attachEvent) {
		window.attachEvent('on'+name, fn);
	} else {
		window.addEventListener(name, fn, false);
	}
};
var onbody = function(fn) {
	if (document.body) {
		fn();
	} else {
		addEvent('load', fn);
	}
};
var querify = function(query) {
	var result = '';

	for (var i in query) {
		result += i+'='+encodeURIComponent(query[i]);
	}
	return result;
};
var send = function(method, path, data, ondone) {
	var xhr = pool.length ? pool.pop() : new XMLHttpRequest();

	var id = ''+(++cnt);
	var called = false;

	var callback = function(err, value) {
		if (called) {
			return;
		}
		called = true;
		ondone(err, value);
	};

	active[id] = xhr;
	
	var tidy = function() {
		delete active[id];
		xhr.onreadystatechange = noop;		
	};
	var onresponse = function() {
		pool.push(xhr);

		if (!/2\d\d/.test(xhr.status)) {
			callback(new Error('invalid status='+xhr.status));
			return
		}
		callback(null, xhr.responseText);
	};

	xhr.open(method, path, true);
	xhr.onreadystatechange = function() {
		if (xhr.readyState !== 4) {
			return;
		}
		tidy();
		setTimeout(onresponse, 1); // push it to the event stack
	};
	xhr.send(data);
	
	return function() {
		if (called) {
			return;
		}
		tidy();
		xhr.abort();
		callback(new Error('request aborted'));
	};
};
var proxy = function(url) {
	if (url.indexOf('://') === -1) {
		url = window.location.protocol+'//'+window.location.host+url;
	}
	if (cache[url]) {
		return cache[url];
	}

	var host = url.match(/^[^:]+:\/\/[^\/]+/i)[0];
	var callbacks = {};
	var stack = [];

	var post = function() {
		var ifr = document.createElement('iframe');

		ifr.src = url;
		ifr.style.display = 'none';

		onbody(function() {
			document.body.appendChild(ifr);		
		});
		
		return function(message) {
			ifr.contentWindow.postMessage(JSON.stringify(message), '*');
			message = null; // no ie leaks					
		};
	}();
	var send = function(message, callback) {
		var destroy;

		stack.push(function() {
			if (destroy) {
				return;
			}
			destroy = send(message, callback);
		});
		return function() {
			if (destroy) {
				destroy();
				return;
			}
			destroy = true;
			callback(new Error('request cancelled'));
		};
	};
	var ready = function() {
		send = function(params, callback) {
			var id = 's'+(cnt++);
			
			callbacks[id] = function(err, result) {
				delete callbacks[id];

				callback(err, result);
			};
			post({name:'request', id:id, params:params});

			return function() {
				if (callbacks[id]) {
					post({name:'destroy', id:id});
					callbacks[id](new Error('request cancelled'));
				}
			};
		};
		while (stack.length) {
			stack.shift()();
		}
		stack = undefined;
	};

	addEvent('message', function(e) {
		if (e.origin !== host) {
			return;
		}
		if (stack) {
			ready();
			return;
		}
		var message = JSON.parse(e.data);

		(callbacks[message.id] || noop)(message.error && new Error(message.error), message.result);				
		message = null; // no ie leaks
	});

	return cache[url] = function(method, path, data, callback) {
		return send([method, path, data], callback);
	};
};


var Request = function(method, url, send) {
	url = url.split('?');

	this._send = send;
	this._method = method;
	this._url = url[0];
	this._query = (url[1] || '') && '?'+url[1];
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

	this.destroy = this._send(this._method, this._url+this._query, data, function(err, value) {
		if (self._timeout) {
			clearTimeout(self._timeout);
		}
		if (err) {
			callback(err);
			return;
		}
		try {
			value = self._decode(value);
		} catch(err) {
			callback(err);
			return;
		}
		callback(null, value);
	});

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
JSONP.prototype.async = function(callback) {
	this._async = true;
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

	var attachErrorHandling = function() {
		if (!document.getElementById(id)) {
			return; // safety
		}
		document.getElementById(id).onreadystatechange = function() {
			if (ended || (this.readyState !== 'loaded' && this.readyState !== 'complete')) {
				return;
			}
			onresult(new Error('jsonp request failed'));								
		};		
	};

	if (document.body || this._async) {
		onbody(function() {
			var el = document.createElement('script');

			el.async = true;
			el.src = url;
			el.id = id;

			document.body.appendChild(el);
			
			el = null; // no leaks
			attachErrorHandling();
		});
	} else {
		document.write(unescape('%3Cscript')+' src="'+url+'" id="'+id+'"'+unescape('%3E%3C/script%3E'));
		attachErrorHandling();
	}
	
	this.destroy = function() {
		onresult(new Error('jsonp request was cancelled'));
		globalScope[id] = noop;

		setTimeout(function() { 
			delete globalScope[id]; // we lazy collect the noop after 2 mins to allow the server to respond without an error
		}, 2*60*1000);
	};

	return this;
};
JSONP.prototype.destroy = noop;

JSONP.prototype._short = Request.prototype._short; // exactly the same


var methods = {'POST':0, 'GET':0, 'DELETE':'del', 'PUT':0};

var define = function(method, sender) {
	return function(url, callback) {
		var req = new Request(method, url, sender || send);

		if (callback) {
			req.send(callback);
		}

		return req;
	};
};
var defineTo = function(that, send) {
	for (var method in methods) {
		that[(methods[method] || method).toLowerCase()] = define(method, send);
	}	
};

exports.cors = ('withCredentials' in new XMLHttpRequest());
exports.proxyable = typeof window.postMessage === 'function';

exports.jsonp = function(url, callback) {
	var req = new JSONP(url);

	if (callback) {
		req.send(callback);
	}
	return req;
};
exports.proxy = function(host) {
	if (!exports.proxyable) {
		return null;
	}
	
	var that = {};
	var send = proxy(host);

	defineTo(that, send);

	that.cors = exports.cors;
	that.proxyable = exports.proxyable;
	that.proxy = exports.proxy;
	that.jsonp = exports.jsonp;

	return that;
};

defineTo(exports, send);