#!/usr/bin/env electron

const { app, BrowserWindow, session, Menu, dialog, Tray, remote, ipcMain, nativeImage, Notification, shell, clipboard } = require('electron');
const { autoUpdater } = require("electron-updater");
const { Client } = require('./WhatsBot/index');
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");
autoUpdater.checkForUpdatesAndNotify();
var path = require('path');
const dns = require("dns");
const Store = require('electron-store');
const windowStateKeeper = require('electron-window-state');
const fs = require('fs');
const os = require('os')
const getPortSync = require('get-port-sync');
const createDesktopShortcut = require('create-desktop-shortcuts');
const homedir = require('os').homedir();
const walcinfo = require('./package.json');
const lsbRelease = require('lsb-release');


var trayIcon;
// Information to be displayed in About Dialog
var aboutWALC;

let isConnected = true;
let firstCall = true;
let preventExit = true;

let pieBrowser;
let botClient;

let customeTitle = "WALC";

let preventTitleChange = true;

lsbRelease(function (_, data) {
    aboutWALC = `Installation Type: ${process.env.APPIMAGE ? "AppImage" : ((isSNAP) ? "Snap" : "Manual")}
${isSNAP ? `Snap Version:${process.env.SNAP_VERSION}(${process.env.SNAP_REVISION})` : ""}OS: ${data ? data.description : "Unknown (probably missing lsb_release)"}
`;
});

// set user agent manually
const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.80 Safari/537.36';
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
findID = null;
emptyBody = null;

let freePort = null;
try {
    freePort = getPortSync();
    pie.initialize(app, freePort);
}
catch (e) { console.log(e); }

//SNAP Information
const isSNAP = process.env.SNAP !== undefined && process.env.SNAP !== null;

const shortcutDir = path.join(homedir, ".local/share/applications");
//Create Desktop Shortcut for AppImage
function integrateToDesktop(win) {
    const iconDir = path.join(homedir, ".local/share/WALC");
    const iconPath = path.join(iconDir, "logo256x56.png");
    fs.mkdirSync(shortcutDir, { recursive: true });
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, "icons/logo256x256.png"), iconPath);
    const shortcutCreated = createDesktopShortcut({
        onlyCurrentOS: true,
        customLogger: (msg, error) => {
            dialog.showMessageBoxSync(win, {
                type: 'error',
                buttons: ['OK'],
                title: 'Desktop Integration',
                message: msg
            });
        },
        "linux": {
            filePath: process.env.APPIMAGE,
            outputPath: shortcutDir,
            name: 'WALC',
            description: 'WALC - unofficial WhatsApp Linux Client',
            icon: iconPath,
            type: 'Application',
            terminal: false,
            chmod: true
        }
    });
    if (shortcutCreated) {
        dialog.showMessageBoxSync(win, {
            type: 'info',
            buttons: ['OK'],
            title: 'Desktop Integration',
            message: "WALC has successfully been integrated to your Applications."
        });
    }
}


//Default Settings
var settings = new Store({
    name: 'settings',
    defaults: {
        askOnExit: {
            value: true,
            name: 'Ask on Exit',
            description: 'If enabled, WALC will confirm everytime you want to close it. Default is true.'
        },
        multiInstance: {
            value: false,
            name: 'Allow Multiple Instances',
            description: "It allows you open multiple instances of WALC so you can login to more than one WhatsApp account. It is disabled by default."
        },
        alwaysOnTop: {
            value: false,
            name: 'Always On Top',
            description: 'Allow WALC to always be shown in front of other apps'
        },
        closeToTray: {
            value: false,
            name: 'Close to Tray',
            description: 'If enabled, WALC will be hidden everytime you want to close it. Default is false.'
        },
        startHidden: {
            value: false,
            name: 'Start Hidden',
            description: 'Hide WALC on startup'
        },
        darkMode: {
            value: false,
            name: 'Dark Mode',
            description: 'Enable Dark Mode in WhatsApp Web'
        },
        autoHideMenuBar: {
            value: false,
            name: "Auto-Hide Menu Bar",
            description: "Auto-hide top menu bar"
        },
        countMuted: {
            value: true,
            name: 'Include Muted Chats',
            description: 'Count muted chats in the badge counter'
        }
    }
});


const WhatsAppMenu = [{
    label: "Archive All Chats",
    sublabel: "Archive all private and group chats",
    click: async (menuItem) => {
        menuItem.enabled = false;
        await archiveAllChats();
        menuItem.enabled = true;
    }
}, {
    label: "Mark All As Read",
    sublabel: "Mark all chat as read",
    click: async (menuItem, window, e) => {
        menuItem.enabled = false;
        await markAllChatsAsRead();
        menuItem.enabled = true;
    }
}, {
    label: 'separator',
    type: 'separator'
}, {
    label: "Dark Mode",
    sublabel: "Toggle Dark Mode",
    type: 'checkbox',
    checked: settings.get('darkMode.value'),
    click: (menuItem, window, e) => {
        settings.set('darkMode.value', menuItem.checked);
        win.webContents.send("setDarkMode", menuItem.checked);
    }
}];

const settingsMenu = [{
    label: settings.get('askOnExit.name'),
    sublabel: 'Ask before exiting this window',
    type: 'checkbox',
    checked: settings.get('askOnExit.value'),
    click: (menuItem, window, e) => {
        settings.set('askOnExit.value', menuItem.checked);
        preventExit = true;
    },
}, {
    label: settings.get('multiInstance.name'),
    sublabel: 'Allow using multiple WhatsApp accounts',
    type: 'checkbox',
    checked: settings.get('multiInstance.value'),
    click: (menuItem, window, e) => {
        settings.set('multiInstance.value', menuItem.checked);
        preventExit = true;
    },
}, {
    label: settings.get('closeToTray.name'),
    sublabel: 'Keep WALC open in Background',
    type: 'checkbox',
    checked: settings.get('closeToTray.value'),
    click: (menuItem) => {
        settings.set('closeToTray.value', menuItem.checked);
    }
}, {
    label: settings.get('startHidden.name'),
    sublabel: 'Keep WALC closed to Tray on Start',
    type: 'checkbox',
    checked: settings.get('startHidden.value'),
    click: (menuItem) => {
        settings.set('startHidden.value', menuItem.checked);
    }
}, {
    label: settings.get('countMuted.name'),
    sublabel: settings.get('countMuted.description'),
    type: 'checkbox',
    checked: settings.get('countMuted.value'),
    click: (menuItem) => {
        settings.set('countMuted.value', menuItem.checked);
        win.webContents.send('renderTray');
    }
}, {
    label: "Update Desktop Integration",
    sublabel: 'Update WALC Desktop Shortcut',
    type: 'normal',
    checked: settings.get('multiInstance.value'),
    click: (menuItem, window, e) => {
        integrateToDesktop(window);
    },
    visible: process.env.APPIMAGE !== undefined
}, {
    label: "Auto-Hide Menu Bar",
    sublabel: "Toggle menu bar visibility using Alt",
    type: 'checkbox',
    checked: settings.get("autoHideMenuBar.value"),
    click: (menuItem) => {
        settings.set('autoHideMenuBar.value', menuItem.checked);
        if (menuItem.checked) {
            win.setMenuBarVisibility(false);
        } else {
            win.setMenuBarVisibility(true);
        }
        win.autoHideMenuBar = menuItem.checked;
    }
}];
const windowMenu = [{
    label: 'Debug Tools',
    sublabel: 'Toggle Chrome Developer Tools',
    role: 'toggleDevTools'
}, {
    label: 'Reload Without Cache',
    sublabel: 'Reload after discarding cached data',
    role: 'forceReload'
}, {
    label: 'separator',
    type: 'separator'
}, {
    label: 'Always On Top',
    type: 'checkbox',
    sublabel: 'Keep this window on top of all other windows',
    checked: settings.get('alwaysOnTop.value'),
    click: (menuItem) => {
        settings.set('alwaysOnTop.value', menuItem.checked);
        win.setAlwaysOnTop(menuItem.checked);
    }

}, {
    label: 'Zoom',
    sublabel: 'Set Zoom of this Window',
    type: 'submenu',
    submenu: [{
        label: 'Zoom In',
        sublabel: 'Increase Zoom',
        role: 'zoomIn',
    }, {
        label: 'Zoom Out',
        sublabel: 'Decrease Zoom',
        role: 'zoomOut',
    }, {
        label: 'Reset Zoom',
        sublabel: 'Reset Zoom to 100%',
        role: 'resetZoom',
    }]
}, {
    label: 'separator',
    type: 'separator'
}, {
    label: 'Exit',
    sublabel: 'Quit current window of WALC completely',
    type: 'normal',
    click: () => {
        app.isQuiting = true;
        app.quit();
    },
}];

const helpMenu = [{
    label: 'Find Help',
    sublabel: 'View Related Issues on GitHub',
    click: () => {
        shell.openExternal(walcinfo.bugs.url);
    },
    accelerator: 'F1'
}, {
    label: 'Report Problem',
    sublabel: 'Create an Bug Report on GitHub',
    click: () => {
        shell.openExternal(walcinfo.bugs.url + "/new/?template=bug_report.md&labels=bug&title=[Bug+Report]");
    }
}, {
    label: 'separator',
    type: 'separator'
}, {
    label: 'Request a Feature',
    sublabel: 'Create a new feature request on GitHub',
    click: () => {
        shell.openExternal(walcinfo.bugs.url + "/new/?template=feature_request.md&labels=enhancement&title=[Feature+Request]");
    }
}, {
    label: 'Vote for a Feature',
    sublabel: 'Vote for existing features on FeatHub',
    click: () => {
        shell.openExternal("https://feathub.com/cstayyab/WALC");
    }
}, {
    label: 'separator',
    type: 'separator'
}, {
    label: 'Rate && Review WALC',
    sublabel: 'Help WALC grow by reviewing',
    click: () => {
        rateAndReviewWALC();
    }
}, {
    label: 'About WALC',
    sublabel: 'See Version and Diagnostic Info.',
    click: () => {

        dialog.showMessageBox(win, {
            type: "info",
            buttons: ["Copy to Clipboard", "Close"],
            defaultId: "0",
            title: "About WALC",
            cancelId: "0",
            message: `WALC ${walcinfo.version}`,
            detail: aboutWALC,
            icon: "icons/logo256x256.png"
        }).then(({ response }) => {
            if (response == 0) {
                clipboard.writeText(`WALC ${walcinfo.version}` + "\n" + aboutWALC)
                new Notification({ "title": "About WALC", "body": "Information Copied to Clipboard.", "silent": true, "icon": "icons/logo256x256.png" }).show()
            }
        });
    }
}]

const mainmenu = [{
    label: '&WhatsApp',
    submenu: WhatsAppMenu
}, {
    label: '&Settings',
    submenu: settingsMenu,
}, {
    label: 'Wi&ndow',
    submenu: windowMenu,
}, {
    label: '&Help',
    submenu: helpMenu
}];

function toggleVisibility() {
    if (win.isVisible()) win.hide();
    else win.show();
    trayIcon.setContextMenu(Menu.buildFromTemplate(getTrayMenu()));
}

function getTrayMenu() {
    let visibilityLabel = (win.isVisible() ? 'Hide' : 'Show') + ' WALC';
    return [{
        label: visibilityLabel,
        click: toggleVisibility
    }, {
        label: 'Quit',
        click: function () {
            preventExit = false;
            app.isQuiting = true;
            app.quit();
        }
    }];
}

ipcMain.on('renderTray', function (event, data) {
    const img = nativeImage.createFromDataURL(data);
    trayIcon.setImage(img);
});

ipcMain.on('liveCheck', liveCheck);

function loadWA() {
    //Close second instance if multiInstance is disabled
    const multiInstance = settings.get('multiInstance.value');
    const singleLock = app.requestSingleInstanceLock();
    if (!singleLock && !multiInstance) {
        win = null;
        app.isQuiting = true;
        app.quit();
        process.exit(0);
        return;
    } else {
        app.on('second-instance', (event, cmdLine, workingDir) => {
            if (!multiInstance && win) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
        });
    }
    const menubar = Menu.buildFromTemplate(mainmenu);
    Menu.setApplicationMenu(menubar);
    win.setMenuBarVisibility(!settings.get('autoHideMenuBar.value'));

    win.loadURL('https://web.whatsapp.com', { 'userAgent': userAgent }).then(async () => {
        pie.connect(app, puppeteer).then(async (b) => {
            pieBrowser = b;
            let page;
            try {
                page = await pie.getPage(pieBrowser, win);
            }
            catch (e) {
                // return
                console.log(e);
            }
            const KEEP_PHONE_CONNECTED_IMG_SELECTOR = '[data-asset-intro-image-light="true"], [data-asset-intro-image-dark="true"]';
            await page.waitForSelector(KEEP_PHONE_CONNECTED_IMG_SELECTOR, { timeout: 0 });
            botClient = new Client();
            await botClient.initialize(page, win);
            if (firstCall) {
                firstCall = false;
                win.webContents.executeJavaScript("Notification.requestPermission(function(p){if(p=='granted'){new Notification('WALC Desktop Notifications', {body:'Desktop Notifications are enabled.', icon:'https://web.whatsapp.com/favicon.ico'});};});");
                botClient.on('message', (msg) => {
                    console.log(msg.body);
                });
                botClient.on('ready', () => {
                    customeTitle = `WALC`;
                    preventTitleChange = false;
                    win.setTitle(customeTitle);
                    preventTitleChange = true;
                });

            }
        }).catch((err) => {
            console.log(err);
        });

    }).catch((err) => {
        liveCheck();
    });

    win.on('page-title-updated', (evt) => {
        if (preventTitleChange) {
            evt.preventDefault();
            preventTitleChange = false;
            win.setTitle(customeTitle);
            preventTitleChange = true;
        }

    });
    win.webContents.on('found-in-page', function (evt, result) {
        if (result.requestId == findID) {
            if (result.matches > 0) {
                //win.webContents.executeJavaScript("navigator.serviceWorker.getRegistration().then(function (r) { console.log(r); document.body.style.display='none'; r.unregister().then(function(success){if(success){window.location.reload();}}); });");
                win.webContents.session.clearStorageData({ storages: ["serviceWorkers"] }).then(() => {
                    loadWA();
                }).catch((err) => {
                    //console.log(err)
                });

            }
        }

    });
    win.webContents.on('did-finish-load', (evt) => {
        findID = win.webContents.findInPage('Update Google Chrome');

    });
}

function liveCheck() {
    dns.resolve("web.whatsapp.com", function (err, addr) {
        if (err) {
            if (isConnected) {
                win.loadFile('offline.html');
                new Notification({ "title": "WALC disconnected", "body": "Please check your connection.", "silent": false, "icon": "icons/logo256x256.png" }).show();
                botClient = null;
            } else {
                win.webContents.send('offline');
            }
            isConnected = false;
        } else {
            loadWA();
            isConnected = true;
        }
    });
}

function createWindow() {
    // Yet another attempt to handle WhatsApp Web ServiceWorker.js error (Issue #21)
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = userAgent;
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // Load the previous state with fallback to defaults
    let windowState = windowStateKeeper({
        defaultWidth: 800,
        defaultHeight: 600
    });

    // Create the browser window.
    win = new BrowserWindow({
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        title: 'WALC',
        icon: path.join(__dirname, 'icons/logo256x256.png'),
        webPreferences: {
            nodeIntegration: true,
            preload: `${__dirname}/preload.js`,
        },
        show: !settings.get('startHidden.value'),
        autoHideMenuBar: settings.get('autoHideMenuBar.value'),
    });
    win.setMenuBarVisibility(!settings.get('autoHideMenuBar.value'));
    win.setAlwaysOnTop(settings.get('alwaysOnTop.value'));
    trayIcon = new Tray(path.join(__dirname, 'icons/logo256x256.png'));
    //Hide Default menubar
    win.setMenu(null);

    // Check connection and load the Main Page of the app.
    liveCheck();
    win.setTitle('WALC');
    trayIcon.setTitle('WALC');
    trayIcon.setToolTip('WALC');
    trayIcon.on('click', toggleVisibility);

    trayIcon.setContextMenu(Menu.buildFromTemplate(getTrayMenu()));

    // register window state listeners
    windowState.manage(win);

    win.on('close', e => {
        e.preventDefault();
        if (settings.get('closeToTray.value') && !app.isQuiting) {
            toggleVisibility();
        } else if (settings.get('askOnExit.value') && preventExit) {
            res = dialog.showMessageBoxSync(win, {
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Exit?',
                message: "Are you sure you want to exit WALC?"
            });
            if (res == 0) {
                preventExit = false;
                app.exit();
            }
        } else {
            preventExit = false;
            app.exit();
        }
    });


    // Emitted when the window is closed.
    win.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null;
    });
    win.webContents.on('new-window', (event, url) => {
        event.preventDefault();
        require('electron').shell.openExternal(url);
    });

    if (process.env.APPIMAGE !== undefined && !fs.existsSync(path.join(shortcutDir, "WALC.desktop"))) {
        //Desktop Integration of AppImage
        integrate = dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Desktop Integration',
            message: "Do you want to integrate WALC to your Applications?"
        });

        if (integrate == 0) {
            integrateToDesktop(win);
        }
    }

}




// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow();
    }
});

/* Additional Functions */
function openInSnapStore() {
    shell.openExternal("snap://walc");
}

function viewOnLinuxApps() {
    shell.openExternal("https://www.linux-apps.com/p/1383431/");
}

function rateAndReviewWALC() {
    if (isSNAP) {
        openInSnapStore();
    } else {
        viewOnLinuxApps();
    }
}

/* All functions related to WhatsBot */
async function archiveAllChats() {
    currentNotify = new Notification({ "title": "Archive All Chats", "body": "Archiving all chats . . .", "silent": true, "icon": "icons/logo256x256.png" })
    currentNotify.show();
    chats = await botClient.getChats()
    chats.forEach(async (chat) => {
        await chat.archive();
    })
    currentNotify.close();
    new Notification({ "title": "Archive All Chats", "body": "All chats have been archived.", "silent": true, "icon": "icons/logo256x256.png" })

}

async function markAllChatsAsRead() {
    chats = await botClient.getChats()
    chats.forEach(async (chat) => {
        await chat.sendSeen();
    });
}
