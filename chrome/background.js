
(function() {
	let checkInterval  = null;
	let intervalLength = null;

	const icons = {
		idle:    'icons/16.png',
		updates: 'icons/whatpumpkin.gif',
	};

	let badgeColour = '#00AA00';
	if (jmtyler.settings.get('is_debug_mode')) {
		badgeColour = '#BB0000';

		chrome.browserAction.setBadgeBackgroundColor({ color: badgeColour });
		chrome.browserAction.setBadgeText({ text: 'dbg' });
	}

	const Main = () => {
		jmtyler.log('executing Main()');

		// const vapidKey = 'BB0WW0ANGE7CquFTQC0n68DmkVrInd616DEi3pI5Yq8IKHv0v9qhvzkAInBjEw2zNfgx29JB2DAQkV_81ztYpTg';
		// chrome.gcm.register([ vapidKey ], (registrationId) => {
		chrome.instanceID.getToken({ authorizedEntity: '710329635775', scope: 'GCM' }, (token) => {
			console.log('registered with gcm', token || chrome.runtime.lastError.message);

			// TODO: Now that we're using FCM, we should be able to switch to a nonpersistent background script, right?
			// TODO: For some features, we must specify a lowest supported Chrome version.  Will that allow us to use ES6 features too?
			chrome.gcm.onMessage.addListener(({ data }) => {
				console.log('received gcm message', data);
				messageHandlers.freshPotato(data);
			});
		});

		intervalLength = jmtyler.settings.map('check_frequency').seconds * 1000;

		let lastPageRead      = jmtyler.memory.get('last_page_read');
		const latestUpdate    = jmtyler.memory.get('latest_update');
		const doShowPageCount = jmtyler.settings.get('show_page_count');

		if (lastPageRead == null) {
			lastPageRead = "https://www.homestuck.com/story/1";  // Default to the first page of Homestuck
			jmtyler.memory.set('last_page_read', lastPageRead);
		}

		// After startup, make sure the browser action still looks as it should with context.
		chrome.browserAction.setTitle({ title: chrome.runtime.getManifest().name + '\n' + lastPageRead });
		chrome.browserAction.setIcon({ path: icons.idle });
		if (lastPageRead == latestUpdate) {
			chrome.browserAction.setBadgeText({ text: '' });
		} else if (latestUpdate !== false && doShowPageCount) {
			// TODO: Should probably start storing the unread pages count so we don't have to do this.
			const lastPageReadId     = parseInt(lastPageRead.substr(lastPageRead.length - 6), 10);
			const latestUpdatePageId = parseInt(latestUpdate.substr(latestUpdate.length - 6), 10);
			const unreadPageCount    = latestUpdatePageId - lastPageReadId;

			chrome.browserAction.setBadgeBackgroundColor({ color: badgeColour });
			chrome.browserAction.setBadgeText({ text: unreadPageCount.toString() });
		}

		chrome.browserAction.onClicked.addListener(GotoMspa);

		chrome.extension.onRequest.addListener((request) => {
			switch (request.method) {
				case 'forceCheck':
					jmtyler.memory.clear('http_last_modified');
					jmtyler.memory.clear('latest_update');
					CheckForUpdates();
					break;
			}
		});

		chrome.notifications.onClicked.addListener((id) => {
			chrome.notifications.clear(id);
			GotoMspa();
		});

		const messageHandlers = {
			freshPotato({ story, arc, endpoint, page }) {
				// Show notification for new updates.
				const iconUrl = jmtyler.settings.get('toast_icon_uri');
				const title   = "Homestuck.com - " + story;
				const message = "Update!! Click here to start reading!";

				PlaySound();

				chrome.notifications.create({ type: 'basic', title, message, iconUrl }, (id) => {
					// TODO: This doesn't seem to have an effect.  The toast is clearing itself automatically.
					setTimeout(() => {
						chrome.notifications.clear(id);
					}, 10000);
				});
			},
		};
		// chrome.runtime.onMessage.addListener((message) => {
		// 	if (message.method && message.args && messageHandlers[message.method]) {
		// 		return messageHandlers[message.method](message.args);
		// 	}
		// });

		chrome.contextMenus.create({
			title:               "Mark as my Last Read page",
			documentUrlPatterns: ["https://www.homestuck.com/*"],
			contexts:            ['page', 'frame', 'link', 'image', 'video', 'audio'],  // Pretty much as long as it is on the MSPA website.
		});
		chrome.contextMenus.onClicked.addListener((info) => {
			const pageUrl = info.pageUrl;
			jmtyler.memory.set('last_page_read', pageUrl);
			chrome.browserAction.setTitle({ title: chrome.runtime.getManifest().name + '\n' + pageUrl });

			const latestUpdate = jmtyler.memory.get('latest_update');
			if (latestUpdate !== false && doShowPageCount) {
				const lastPageReadId     = parseInt(pageUrl.substr(pageUrl.length - 6), 10);
				const latestUpdatePageId = parseInt(latestUpdate.substr(latestUpdate.length - 6), 10);
				const unreadPageCount    = latestUpdatePageId - lastPageReadId;

				chrome.browserAction.setBadgeBackgroundColor({ color: badgeColour });
				chrome.browserAction.setBadgeText({ text: unreadPageCount.toString() });
			}
			// Considered forcing a recheck after setting your new page, but decided there's no point.
			// Leaving this here in case I change my mind, but I'll probably remove it after a few commits.
			//jmtyler.memory.clear('http_last_modified');
			//jmtyler.memory.clear('latest_update');
			//CheckForUpdates();
		});

		chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
			if (typeof changeInfo.url == "undefined") {
				return;
			}

			const currentPageUrl = changeInfo.url;

			// This listener isn't triggered AFTER a regex filter like the context menu, so must do it ourselves.
			const currentPage = currentPageUrl.match(/^https:\/\/www\.homestuck\.com\/([a-z/-]+)($|\/([0-9]+))/);
			if (currentPage === null) {
				// This is not an MSPA comic page, so we don't care about it.
				return;
			}

			const savedPageUrl = jmtyler.memory.get('last_page_read');
			const savedPage    = savedPageUrl.match(/^https:\/\/www\.homestuck\.com\/([a-z/-]+)($|\/([0-9]+))/);

			// Strip the page IDs off this page's URL and our saved page's URL, then compare them.
			const currentStory  = currentPage[1];
			const currentPageId = parseInt(currentPage[3] || '1', 10);
			const savedStory    = savedPage[1];
			const savedPageId   = parseInt(savedPage[3] || '1', 10);

			if (currentStory === savedStory && currentPageId > savedPageId) {
				// This page is LATER than the last page we've read, so this is the new one!
				jmtyler.memory.set('last_page_read', currentPageUrl);
				chrome.browserAction.setTitle({ title: chrome.runtime.getManifest().name + '\n' + currentPageUrl });
				chrome.browserAction.setIcon({ path: icons.idle });

				const latestUpdate = jmtyler.memory.get('latest_update');
				if (latestUpdate !== false && doShowPageCount) {
					const latestUpdatePageId = parseInt(latestUpdate.substr(latestUpdate.length - 6), 10);
					const unreadPageCount    = latestUpdatePageId - currentPageId;

					chrome.browserAction.setBadgeBackgroundColor({ color: badgeColour });
					chrome.browserAction.setBadgeText({ text: unreadPageCount.toString() });
				}
			}
		});

		// Make some key functions globally accessible for debug mode.
		if (jmtyler.settings.get('is_debug_mode')) {
			window.GotoMspa        = () => GotoMspa();
			window.CheckForUpdates = () => CheckForUpdates();
			window.PlaySound       = () => PlaySound();
			window.ClearData       = () => ClearData();

			return;  // Don't want the interval running during debug mode.
		}

		// Kick it all off!
		checkInterval = setInterval(CheckForUpdates, intervalLength);
		CheckForUpdates();
	};

	/**
	 * Set button icon as idle, open a new tab with the last page read,
	 * and set the new 'last page read' as the latest update available.
	 */
	const GotoMspa = () => {
		try {
			const latestUpdate = jmtyler.memory.get('latest_update');
			const lastPageRead = jmtyler.memory.get('last_page_read') || "https://www.homestuck.com";

			jmtyler.log('executing GotoMspa()', latestUpdate, lastPageRead);

			chrome.tabs.create({ url: lastPageRead });
		} catch (e) {
			jmtyler.log('failed to open new tab for MSPA', e);
		}

		return;
	};

	/**
	 * Queries the MSPA RSS feed.  Changes the button icon if there is an error
	 * or if there are new updates available.  If there are updates, adds a count
	 * onto the button.
	 */
	const CheckForUpdates = () => {
		jmtyler.log('executing CheckForUpdates()');

		const areNotificationsOn = jmtyler.settings.get('notifications_on');
		const doShowPageCount    = jmtyler.settings.get('show_page_count');
		const newIntervalLength  = jmtyler.settings.map('check_frequency').seconds * 1000;

		// Interval length setting has been changed, so set a new interval.
		// TODO: Changes to interval length should take effect immediately.
		if (newIntervalLength != intervalLength && !jmtyler.settings.get('is_debug_mode')) {
			intervalLength = newIntervalLength;
			if (checkInterval != null) {
				clearInterval(checkInterval);
			}
			checkInterval = setInterval(CheckForUpdates, intervalLength);
		}

		const lastPageRead = jmtyler.memory.get('last_page_read');
		const latestUpdate = jmtyler.memory.get('latest_update');

		// TODO: All the following XHR crap is incredibly grotesque... put some time into encapsulating & simplifying it.

		const feedUri = "http://mspaintadventures.com/rss/rss.xml";

		const pingRequest = new XMLHttpRequest();
		pingRequest.onload = () => {
			const myLastModified    = jmtyler.memory.get('http_last_modified');
			const theirLastModified = pingRequest.getResponseHeader('Last-Modified');

			jmtyler.log('completed ping request', lastPageRead, latestUpdate, myLastModified, theirLastModified);

			if (myLastModified == theirLastModified) {
				// No updates.
				return;
			}

			jmtyler.memory.set('http_last_modified', theirLastModified);

			const contentRequest = new XMLHttpRequest();
			contentRequest.onload = () => {
				jmtyler.log('completed content request', contentRequest.responseXML);

				const xml = contentRequest.responseXML;
				if (!xml) {
					console.log('invalid rss feed received.');
					return;
				}

				const pages = xml.getElementsByTagName('item');
				const item  = pages.item(0);
				const guid  = item.getElementsByTagName('guid')[0];

				const newLatestUpdate = guid ? guid.textContent : null;

				if (newLatestUpdate === null) {
					console.log('could not find guid on first rss item');
					return;
				}

				// No need to pop up the notification more than once for the same update!
				if (newLatestUpdate == latestUpdate) {
					return;
				}

				const lastPageReadId     = parseInt(lastPageRead.substr(lastPageRead.length - 6), 10);
				const latestUpdatePageId = parseInt(newLatestUpdate.substr(newLatestUpdate.length - 6), 10);
				const unreadPagesCount   = latestUpdatePageId - lastPageReadId;
				if (unreadPagesCount < 1) {
					chrome.browserAction.setIcon({ path: icons.idle });
					chrome.browserAction.setBadgeText({ text: '' });
					return;
				}

				const unreadPagesText = unreadPagesCount.toString();

				// Update button for new updates.
				if (latestUpdate !== false) {
					chrome.browserAction.setIcon({ path: icons.updates });
				}
				if (doShowPageCount) {
					chrome.browserAction.setBadgeBackgroundColor({ color: badgeColour });
					chrome.browserAction.setBadgeText({ text: unreadPagesText });
				}
				jmtyler.memory.set('latest_update', newLatestUpdate);

				if (areNotificationsOn) {
					// Show notification for new updates.
					const toastIcon    = jmtyler.settings.get('toast_icon_uri');
					const toastTitle   = "New MSPA Update!";
					const toastMessage = "Click here to start reading!" + (doShowPageCount ? ("\n" + unreadPagesText + " new pages") : "");

					PlaySound();

					const notification = new Notification(toastTitle, {
						icon: toastIcon,
						body: toastMessage,
					});
					notification.onclick = function()
					{
						this.close();
						GotoMspa();
					};

					setTimeout(() => {
						notification.close();
					}, 10000);
				}
			};

			contentRequest.onerror = () => {
				// TODO: Seriously have to improve my error reporting.
				console.log('something went wrong, brotha.');
				return;
			};

			jmtyler.log('starting content request');

			contentRequest.open('GET', feedUri, true);
			contentRequest.setRequestHeader('Cache-Control', 'no-cache');
			contentRequest.send(null);

			return;
		};

		pingRequest.onerror = () => {
			console.log('something went wrong, brotha.');
			return;
		};

		jmtyler.log('starting ping request');

		pingRequest.open('HEAD', feedUri, true);
		pingRequest.setRequestHeader('Cache-Control', 'no-cache');
		pingRequest.send(null);

		return;
	};

	const PlaySound = () => {
		const toastSoundUri = jmtyler.settings.get('toast_sound_uri');
		if (toastSoundUri == null) {
			return;
		}

		// Get the existing <audio /> element from the page, if one's already been created ...
		let audio = document.getElementsByTagName('audio');
		if (audio.length > 0) {
			audio = audio[0];
		} else {
			// ... if not, create it.
			audio = document.createElement('audio');
			document.body.appendChild(audio);
			audio.autoplay = true;
			audio.controls = false;
			audio.volume = 1.0;
		}

		// Bam.  Audio automatically plays when you set the 'src' property, apparently.
		audio.src = toastSoundUri;
	};

	const ClearData = () => {
		jmtyler.settings.clear();
		jmtyler.memory.clear();
		chrome.browserAction.setIcon({ path: icons.idle });
		chrome.browserAction.setBadgeText({ text: '' });
	};

	const currentVersion = chrome.runtime.getManifest().version;

	chrome.runtime.onInstalled.addListener((details) => {
		jmtyler.log('executing onInstalled()', currentVersion, details);
		if (currentVersion == details.previousVersion) {
			jmtyler.log('  new version is same as old version... aborting');
			return;
		}

		// If the latest version has already been fully installed, don't do anything. (Not sure how we got here, though.)
		if (jmtyler.version.isInstalled(currentVersion)) {
			jmtyler.log('  new version has already been installed... aborting');
			return;
		}

		// Install the latest version, performing any necessary migrations.
		if (details.reason == "install") {
			jmtyler.log('  extension is newly installed');
			jmtyler.version.install(currentVersion);
		} else if (details.reason == "update" || details.reason == "chrome_update") {
			jmtyler.log('  extension is being updated');
			jmtyler.version.update(details.previousVersion, currentVersion);
		} else {
			jmtyler.log('  extension is in some unhandled state... [' + details.reason + ']');
		}

		jmtyler.log('  done migration, ready to run Main()');

		// Now that we've finished any migrations, we can run the main process.
		Main();
	});

	jmtyler.log('checking if current version has been installed...' + (jmtyler.version.isInstalled(currentVersion) ? 'yes' : 'no'));

	// Only run the main process immediately if the latest version has already been fully installed.
	if (jmtyler.version.isInstalled(currentVersion)) {
		jmtyler.log('current version is installed, running Main() immediately');
		Main();
	}
})();
