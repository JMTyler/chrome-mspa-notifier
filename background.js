
(function() {
	var checkInterval = null,
		intervalLength = 5000;
	
	var icons = {
		idle: 'mspa_face.gif',
		error: 'mspa_reader.gif',
		updates: 'whatpumpkin.gif'
	};
	
	if (typeof(localStorage['interval_length']) != 'undefined') {
		intervalLength = localStorage['interval_length'];
	}
	
	var gotoMspa = function()
	{
		var lastPageRead = "http://mspaintadventures.com";
		if (typeof(localStorage['last_page_read']) != 'undefined') {
			lastPageRead = localStorage['last_page_read'];
		}
		
		var latestUpdate = "http://mspaintadventures.com";
		if (typeof(localStorage['latest_update']) != 'undefined') {
			latestUpdate = localStorage['latest_update'];
		}
		
		chrome.browserAction.setIcon({path: icons.idle});
		chrome.browserAction.setBadgeText({text: ''});
		chrome.tabs.create({url: lastPageRead});
		
		localStorage['last_page_read'] = latestUpdate;
		delete localStorage['latest_update'];
		
		return;
	};
	
	var checkForUpdates = function()
	{
		var lastPageRead = null;
		if (typeof(localStorage['last_page_read']) != 'undefined') {
			lastPageRead = localStorage['last_page_read'];
		}
		
		var feedUri = "http://mspaintadventures.com/rss/rss.xml",
			request = new XMLHttpRequest();
		
		request.onload = function()
		{
			var xml = request.responseXML;
			if (!xml) {
				console.log('invalid rss feed received.');
				return;
			}
			
			var pages = xml.getElementsByTagName('item');
			var count = Math.min(pages.length, 40);
			var item, guid, latestUpdate = null;
			var unreadPagesCount = 0;
			for (var i = 0; i < count; i += 1) {
				item = pages.item(i);
				
				guid = item.getElementsByTagName('guid')[0];
				if (guid) {
					guid = guid.textContent;
				}
				
				if (guid == lastPageRead) {
					break;
				}
				
				if (latestUpdate == null) {
					latestUpdate = guid;
				}
				
				unreadPagesCount++;
			}
			
			if (unreadPagesCount < 1) {
				chrome.browserAction.setIcon({path: icons.idle});
				return;
			}
			
			var unreadPagesText = unreadPagesCount + '';
			if (unreadPagesCount == 40) {
				unreadPagesText += '+';
			}
			
			localStorage['latest_update'] = latestUpdate;
			chrome.browserAction.setIcon({path: icons.updates});
			chrome.browserAction.setBadgeBackgroundColor({color: '#00AA00'});
			chrome.browserAction.setBadgeText({text: unreadPagesText});
			
			return;
		};
		
		request.onerror = function()
		{
			console.log('something went wrong, brotha.')
			chrome.browserAction.setIcon({path: icons.error});
			return;
		};
		
		request.open('GET', feedUri, true);
		request.send(null);
		
		return;
	};
	
	checkInterval = setInterval(checkForUpdates, intervalLength);
	
	chrome.browserAction.onClicked.addListener(gotoMspa);
})();
