const PLOT_WINDOW_MS = 60 * 1000;
const PLOT_REFRESH_INTERVAL_MS = 1000;
const MAX_APPLICATION_LOG_LINES = 1000;
const MAX_RECEIVED_MESSAGE_ENTRIES = 300;
const DEFAULT_AUDIO_CODEC_MIME_TYPES = ['audio/opus'];
const PLOT_COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b'];
const PLOT_RESERVED_KEYS = new Set([
    'timestamp',
    'ts',
    'time',
    'date',
    'datetime',
    'receivedAt',
    'paramId',
    'value',
    'values',
    'samples',
    'series',
    'name',
    'label',
    'group',
    'type',
    'message',
    'content',
    'clientId',
    'latency',
    'latencyMs',
]);

const PERSISTED_FIELDS = [
    {field: 'channelName', type: 'text'},
    {field: 'clientId', type: 'text'},
    {field: 'region', type: 'text'},
    {field: 'accessKeyId', type: 'text'},
    {field: 'secretAccessKey', type: 'text'},
    {field: 'sessionToken', type: 'text'},
    {field: 'endpoint', type: 'text'},
    {field: 'legacy', type: 'radio', name: 'endpoint-type'},
    {field: 'dual-stack', type: 'radio', name: 'endpoint-type'},
    {field: 'openDataChannel', type: 'checkbox'},
    {field: 'useTrickleICE', type: 'checkbox'},
    {field: 'natTraversalEnabled', type: 'radio', name: 'natTraversal'},
    {field: 'forceSTUN', type: 'radio', name: 'natTraversal'},
    {field: 'forceTURN', type: 'radio', name: 'natTraversal'},
    {field: 'natTraversalDisabled', type: 'radio', name: 'natTraversal'},
    {field: 'send-host', type: 'checkbox'},
    {field: 'accept-host', type: 'checkbox'},
    {field: 'send-relay', type: 'checkbox'},
    {field: 'accept-relay', type: 'checkbox'},
    {field: 'send-srflx', type: 'checkbox'},
    {field: 'accept-srflx', type: 'checkbox'},
    {field: 'send-prflx', type: 'checkbox'},
    {field: 'accept-prflx', type: 'checkbox'},
    {field: 'send-tcp', type: 'checkbox'},
    {field: 'accept-tcp', type: 'checkbox'},
    {field: 'send-udp', type: 'checkbox'},
    {field: 'accept-udp', type: 'checkbox'},
    {field: 'log-aws-sdk-calls', type: 'checkbox'},
    {field: 'codec-filter-toggle', type: 'checkbox'},
    {field: 'turn-with-udp', type: 'checkbox'},
    {field: 'turns-with-udp', type: 'checkbox'},
    {field: 'turns-with-tcp', type: 'checkbox'},
    {field: 'turn-one-set-only', type: 'checkbox'},
];

const persistentFieldMap = new Map(PERSISTED_FIELDS.map((definition) => [definition.field, definition]));

let elements = {};
let plotRefreshIntervalId = null;
let activeRunToken = 0;
let audioCodecCapabilities = [];
let uniqueAudioMimeTypes = [];

const originalConsole = {
    debug: console.debug.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

const appState = createInitialState();

document.addEventListener('DOMContentLoaded', initializePage);
window.addEventListener('beforeunload', () => stopViewer({suppressLog: true}));

function createInitialState() {
    return {
        active: false,
        isStarting: false,
        runToken: 0,
        expectDataChannel: false,
        activeClientId: '-',
        signalingClient: null,
        peerConnection: null,
        kinesisVideoClient: null,
        signalingEndpoints: null,
        remoteStream: null,
        audioTransceiver: null,
        dataChannels: new Map(),
        localDataChannel: null,
        lastDataChannelStatus: 'idle',
        signalingStatus: 'idle',
        peerStatus: 'idle',
        iceStatus: 'idle',
        audioStatus: 'waiting',
        sessionStatus: 'Idle.',
        applicationLogLines: [],
        receivedEntries: [],
        receivedMessageCount: 0,
        plotSeries: {},
        plotSeriesOrder: [],
        latestPlotTimestamp: 0,
        plotChart: null,
    };
}

function initializePage() {
    elements = {
        form: document.getElementById('viewer-form'),
        region: document.getElementById('region'),
        regionList: document.getElementById('regionList'),
        accessKeyId: document.getElementById('accessKeyId'),
        secretAccessKey: document.getElementById('secretAccessKey'),
        sessionToken: document.getElementById('sessionToken'),
        channelName: document.getElementById('channelName'),
        clientId: document.getElementById('clientId'),
        openDataChannel: document.getElementById('openDataChannel'),
        useTrickleICE: document.getElementById('useTrickleICE'),
        natTraversalEnabled: document.getElementById('natTraversalEnabled'),
        forceTURN: document.getElementById('forceTURN'),
        forceSTUN: document.getElementById('forceSTUN'),
        natTraversalDisabled: document.getElementById('natTraversalDisabled'),
        codecFilterToggle: document.getElementById('codec-filter-toggle'),
        codecOptions: document.getElementById('codecOptions'),
        audioCodecs: document.getElementById('audioCodecs'),
        resetCodecs: document.getElementById('reset-codecs'),
        legacyEndpoint: document.getElementById('legacy'),
        dualStackEndpoint: document.getElementById('dual-stack'),
        endpoint: document.getElementById('endpoint'),
        startButton: document.getElementById('start-viewer-button'),
        stopButton: document.getElementById('stop-viewer-button'),
        clearDataButton: document.getElementById('clear-data-button'),
        clearLogButton: document.getElementById('clear-log-button'),
        sessionStatus: document.getElementById('session-status'),
        statusClientId: document.getElementById('status-client-id'),
        statusSignaling: document.getElementById('status-signaling'),
        statusPeer: document.getElementById('status-peer'),
        statusIce: document.getElementById('status-ice'),
        statusDataChannel: document.getElementById('status-data-channel'),
        statusAudio: document.getElementById('status-audio'),
        statusMessages: document.getElementById('status-messages'),
        remoteAudio: document.getElementById('remote-audio'),
        receivedDataSummary: document.getElementById('received-data-summary'),
        receivedDataLog: document.getElementById('received-data-log'),
        plotStatus: document.getElementById('plot-status'),
        plotCanvas: document.getElementById('data-plot'),
        applicationLog: document.getElementById('application-log'),
        logAwsSdkCalls: document.getElementById('log-aws-sdk-calls'),
    };

    patchConsole();
    assertRequiredGlobals();
    bindPersistentFields();
    initializeCodecOptions();
    bindUiEvents();
    updateCodecOptionsVisibility();
    updateStatusPanel();
    initializePlotChart();
    syncPlotChart();
    fetchRegions();
    logInfo('Viewer page loaded.');

    plotRefreshIntervalId = window.setInterval(syncPlotChart, PLOT_REFRESH_INTERVAL_MS);

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('view') === 'viewer' || urlParams.get('autostart') === 'true') {
        void startViewer();
    }
}

function assertRequiredGlobals() {
    if (!window.AWS?.KinesisVideo || !window.AWS?.KinesisVideoSignaling) {
        throw new Error('The AWS browser bundle is not loaded. Expected window.AWS with KinesisVideo clients.');
    }

    if (!window.KVSWebRTC?.SignalingClient || !window.KVSWebRTC?.SigV4RequestSigner || !window.KVSWebRTC?.Role) {
        throw new Error('The KVS WebRTC browser bundle is not loaded. Expected window.KVSWebRTC from ../kvs-webrtc.js.');
    }

    if (!window.Chart) {
        throw new Error('Chart.js is not loaded. Expected window.Chart from the Chart.js CDN bundle.');
    }
}

function patchConsole() {
    if (console.__viewerPatched) {
        return;
    }

    console.__viewerPatched = true;
    console.debug = (...args) => {
        appendApplicationLog('DEBUG', args);
        originalConsole.debug(...args);
    };
    console.log = (...args) => {
        appendApplicationLog('INFO', args);
        originalConsole.log(...args);
    };
    console.warn = (...args) => {
        appendApplicationLog('WARN', args);
        originalConsole.warn(...args);
    };
    console.error = (...args) => {
        appendApplicationLog('ERROR', args);
        originalConsole.error(...args);
    };

    window.addEventListener('error', (event) => {
        console.error(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error(event.reason);
    });
}

function bindUiEvents() {
    elements.form.addEventListener('submit', (event) => {
        event.preventDefault();
        void startViewer();
    });

    elements.stopButton.addEventListener('click', () => {
        stopViewer();
    });

    elements.clearDataButton.addEventListener('click', () => {
        clearReceivedData();
        logInfo('Cleared received data and plot.');
    });

    elements.clearLogButton.addEventListener('click', () => {
        appState.applicationLogLines = [];
        renderApplicationLog();
    });

    elements.resetCodecs.addEventListener('click', () => {
        resetCodecPreferences();
    });

    elements.codecFilterToggle.addEventListener('change', () => {
        persistFieldById('codec-filter-toggle');
        updateCodecOptionsVisibility();
    });

    elements.natTraversalEnabled.addEventListener('click', () => {
        applyNatTraversalPreset('stun-turn');
    });
    elements.forceSTUN.addEventListener('click', () => {
        applyNatTraversalPreset('stun-only');
    });
    elements.forceTURN.addEventListener('click', () => {
        applyNatTraversalPreset('turn-only');
    });
    elements.natTraversalDisabled.addEventListener('click', () => {
        applyNatTraversalPreset('disabled');
    });

    elements.remoteAudio.addEventListener('playing', () => {
        appState.audioStatus = 'playing';
        updateStatusPanel();
    });
    elements.remoteAudio.addEventListener('pause', () => {
        if (!appState.remoteStream) {
            appState.audioStatus = 'waiting';
        }
        updateStatusPanel();
    });
}

function bindPersistentFields() {
    const urlParams = new URLSearchParams(window.location.search);

    PERSISTED_FIELDS.forEach((definition) => {
        const element = document.getElementById(definition.field);
        if (!element) {
            return;
        }

        try {
            const localStorageValue = localStorage.getItem(definition.field);
            if (localStorageValue !== null) {
                applyStoredValue(definition, localStorageValue);
            }
        } catch (error) {
            originalConsole.warn('Unable to read localStorage for', definition.field, error);
        }

        if (urlParams.has(definition.field)) {
            applyStoredValue(definition, urlParams.get(definition.field));
        }

        element.addEventListener('change', () => {
            persistFieldById(definition.field);
        });
    });
}

function applyStoredValue(definition, rawValue) {
    const element = document.getElementById(definition.field);
    if (!element) {
        return;
    }

    if (definition.type === 'checkbox' || definition.type === 'radio') {
        element.checked = rawValue === 'true';
    } else {
        element.value = rawValue;
    }
}

function persistFieldById(fieldId) {
    const definition = persistentFieldMap.get(fieldId);
    if (!definition) {
        return;
    }

    const element = document.getElementById(definition.field);
    if (!element) {
        return;
    }

    try {
        if (definition.type === 'checkbox') {
            localStorage.setItem(definition.field, String(element.checked));
            return;
        }

        if (definition.type === 'radio') {
            PERSISTED_FIELDS.filter((candidate) => candidate.name === definition.name).forEach((candidate) => {
                localStorage.setItem(candidate.field, String(candidate.field === definition.field));
            });
            return;
        }

        localStorage.setItem(definition.field, element.value);
    } catch (error) {
        originalConsole.warn('Unable to persist localStorage for', definition.field, error);
    }
}

function initializeCodecOptions() {
    audioCodecCapabilities = getAudioCodecCapabilities();
    uniqueAudioMimeTypes = [...new Set(audioCodecCapabilities.map((codec) => codec.mimeType))].sort();

    elements.audioCodecs.innerHTML = '';

    if (!uniqueAudioMimeTypes.length) {
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Audio codec capabilities are not available in this browser.';
        elements.audioCodecs.appendChild(paragraph);
        elements.resetCodecs.disabled = true;
        return;
    }

    uniqueAudioMimeTypes.forEach((mimeType) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'acodec';
        checkbox.value = mimeType;
        checkbox.addEventListener('change', saveCodecPreferences);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${mimeType}`));

        elements.audioCodecs.appendChild(label);
        elements.audioCodecs.appendChild(document.createElement('br'));
    });

    loadCodecPreferences();
}

function getAudioCodecCapabilities() {
    const capabilitySource = typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function'
        ? RTCRtpReceiver
        : (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function' ? RTCRtpSender : null);

    if (!capabilitySource) {
        return [];
    }

    const capabilities = capabilitySource.getCapabilities('audio');
    return capabilities?.codecs || [];
}

function loadCodecPreferences() {
    const savedAudioCodecs = getSavedAudioCodecMimeTypes();
    document.querySelectorAll('input[name="acodec"]').forEach((checkbox) => {
        checkbox.checked = savedAudioCodecs.includes(checkbox.value);
    });
    saveCodecPreferences();
}

function getSavedAudioCodecMimeTypes() {
    try {
        const savedCodecs = JSON.parse(localStorage.getItem('audioCodecs'));
        if (Array.isArray(savedCodecs) && savedCodecs.length) {
            return savedCodecs;
        }
    } catch (error) {
        originalConsole.warn('Unable to read saved audio codecs.', error);
    }

    return getDefaultAudioCodecMimeTypes();
}

function getDefaultAudioCodecMimeTypes() {
    const defaults = DEFAULT_AUDIO_CODEC_MIME_TYPES.filter((mimeType) => uniqueAudioMimeTypes.includes(mimeType));
    if (defaults.length) {
        return defaults;
    }
    return uniqueAudioMimeTypes.slice();
}

function saveCodecPreferences() {
    const selectedAudioCodecs = Array.from(document.querySelectorAll('input[name="acodec"]:checked')).map((checkbox) => checkbox.value).sort();

    try {
        localStorage.setItem('audioCodecs', JSON.stringify(selectedAudioCodecs));
    } catch (error) {
        originalConsole.warn('Unable to save audio codec preferences.', error);
    }

    elements.resetCodecs.disabled = JSON.stringify(selectedAudioCodecs) === JSON.stringify(getDefaultAudioCodecMimeTypes());
}

function resetCodecPreferences() {
    const defaults = getDefaultAudioCodecMimeTypes();
    document.querySelectorAll('input[name="acodec"]').forEach((checkbox) => {
        checkbox.checked = defaults.includes(checkbox.value);
    });
    saveCodecPreferences();
    logInfo('Reset audio codec filter to defaults.', defaults);
}

function updateCodecOptionsVisibility() {
    elements.codecOptions.hidden = !elements.codecFilterToggle.checked;
}

function applyNatTraversalPreset(mode) {
    const presets = {
        'stun-turn': {
            'accept-host': true,
            'send-host': true,
            'accept-relay': true,
            'send-relay': true,
            'accept-srflx': true,
            'send-srflx': true,
            'accept-prflx': true,
            'send-prflx': true,
        },
        'stun-only': {
            'accept-host': false,
            'send-host': false,
            'accept-relay': false,
            'send-relay': false,
            'accept-srflx': true,
            'send-srflx': true,
            'accept-prflx': false,
            'send-prflx': false,
        },
        'turn-only': {
            'accept-host': false,
            'send-host': false,
            'accept-relay': true,
            'send-relay': true,
            'accept-srflx': false,
            'send-srflx': false,
            'accept-prflx': false,
            'send-prflx': false,
        },
        'disabled': {
            'accept-host': true,
            'send-host': true,
            'accept-relay': true,
            'send-relay': true,
            'accept-srflx': true,
            'send-srflx': true,
            'accept-prflx': true,
            'send-prflx': true,
        },
    };

    const selectedPreset = presets[mode];
    if (!selectedPreset) {
        return;
    }

    Object.entries(selectedPreset).forEach(([fieldId, checked]) => {
        const element = document.getElementById(fieldId);
        if (!element) {
            return;
        }
        element.checked = checked;
        persistFieldById(fieldId);
    });
}

async function fetchRegions() {
    try {
        const response = await fetch('https://api.regional-table.region-services.aws.a2z.com/index.json');
        if (!response.ok) {
            throw new Error(`${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const regions = (data?.prices || [])
            .filter((serviceData) => serviceData?.attributes?.['aws:serviceName'] === 'Amazon Kinesis Video Streams')
            .map((serviceData) => serviceData?.attributes?.['aws:region'])
            .filter(Boolean)
            .sort();

        const uniqueRegions = [...new Set(regions)];
        uniqueRegions.forEach((region) => {
            const option = document.createElement('option');
            option.value = region;
            elements.regionList.appendChild(option);
        });

        logInfo('Fetched AWS regions for Kinesis Video Streams.');
    } catch (error) {
        console.warn('Failed to fetch regions list.', error);
    }
}

function getFormValues() {
    const endpoint = elements.endpoint.value.trim() || undefined;

    return {
        region: elements.region.value.trim(),
        channelName: elements.channelName.value.trim(),
        clientId: elements.clientId.value.trim() || getTabScopedClientId(),
        openDataChannel: elements.openDataChannel.checked,
        useTrickleICE: elements.useTrickleICE.checked,
        natTraversalDisabled: elements.natTraversalDisabled.checked,
        forceTURN: elements.forceTURN.checked,
        forceSTUN: elements.forceSTUN.checked,
        accessKeyId: elements.accessKeyId.value.trim(),
        secretAccessKey: elements.secretAccessKey.value,
        sessionToken: elements.sessionToken.value.trim() || null,
        endpoint,
        useDualStackEndpoints: endpoint === undefined && elements.dualStackEndpoint.checked,
        logAwsSdkCalls: elements.logAwsSdkCalls.checked,
        sendHostCandidates: document.getElementById('send-host').checked,
        acceptHostCandidates: document.getElementById('accept-host').checked,
        sendRelayCandidates: document.getElementById('send-relay').checked,
        acceptRelayCandidates: document.getElementById('accept-relay').checked,
        sendSrflxCandidates: document.getElementById('send-srflx').checked,
        acceptSrflxCandidates: document.getElementById('accept-srflx').checked,
        sendPrflxCandidates: document.getElementById('send-prflx').checked,
        acceptPrflxCandidates: document.getElementById('accept-prflx').checked,
        sendTcpCandidates: document.getElementById('send-tcp').checked,
        acceptTcpCandidates: document.getElementById('accept-tcp').checked,
        sendUdpCandidates: document.getElementById('send-udp').checked,
        acceptUdpCandidates: document.getElementById('accept-udp').checked,
        turnWithUdp: document.getElementById('turn-with-udp').checked,
        turnsWithUdp: document.getElementById('turns-with-udp').checked,
        turnsWithTcp: document.getElementById('turns-with-tcp').checked,
        oneTurnServerSetOnly: document.getElementById('turn-one-set-only').checked,
    };
}

async function startViewer() {
    if (appState.active || appState.isStarting) {
        return;
    }

    if (!elements.form.reportValidity()) {
        return;
    }

    const formValues = getFormValues();
    clearReceivedData({suppressLog: true});

    appState.active = true;
    appState.isStarting = true;
    appState.expectDataChannel = formValues.openDataChannel;
    appState.lastDataChannelStatus = formValues.openDataChannel ? 'negotiating' : 'disabled';
    appState.activeClientId = formValues.clientId;
    appState.sessionStatus = 'Starting viewer...';
    appState.signalingStatus = 'initializing';
    appState.peerStatus = 'initializing';
    appState.iceStatus = 'idle';
    appState.audioStatus = 'waiting';
    appState.runToken = ++activeRunToken;
    updateStatusPanel();
    updateControlState();

    const sanitizedValues = {
        ...formValues,
        accessKeyId: maskSecret(formValues.accessKeyId),
        secretAccessKey: maskSecret(formValues.secretAccessKey),
        sessionToken: maskSecret(formValues.sessionToken),
    };
    logInfo('Starting viewer with options:', sanitizedValues);

    try {
        const runToken = appState.runToken;

        appState.kinesisVideoClient = new AWS.KinesisVideo.KinesisVideoClient({
            region: formValues.region,
            credentials: {
                accessKeyId: formValues.accessKeyId,
                secretAccessKey: formValues.secretAccessKey,
                sessionToken: formValues.sessionToken,
            },
            endpoint: formValues.endpoint,
            useDualstackEndpoint: formValues.useDualStackEndpoints,
            correctClockSkew: true,
            logger: formValues.logAwsSdkCalls ? console : undefined,
        });

        const describeSignalingChannelResponse = await appState.kinesisVideoClient.send(
            new AWS.KinesisVideo.DescribeSignalingChannelCommand({
                ChannelName: formValues.channelName,
            }),
        );
        if (!isCurrentRun(runToken)) {
            return;
        }

        const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
        logInfo('Resolved channel ARN:', channelARN);

        const getSignalingChannelEndpointResponse = await appState.kinesisVideoClient.send(
            new AWS.KinesisVideo.GetSignalingChannelEndpointCommand({
                ChannelARN: channelARN,
                SingleMasterChannelEndpointConfiguration: {
                    Protocols: ['WSS', 'HTTPS'],
                    Role: KVSWebRTC.Role.VIEWER,
                },
            }),
        );
        if (!isCurrentRun(runToken)) {
            return;
        }

        appState.signalingEndpoints = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((result, endpoint) => {
            result[endpoint.Protocol] = endpoint.ResourceEndpoint;
            return result;
        }, {});
        logInfo('Resolved signaling endpoints:', appState.signalingEndpoints);

        const signalingChannelsClient = new AWS.KinesisVideoSignaling.KinesisVideoSignalingClient({
            region: formValues.region,
            credentials: {
                accessKeyId: formValues.accessKeyId,
                secretAccessKey: formValues.secretAccessKey,
                sessionToken: formValues.sessionToken,
            },
            endpoint: appState.signalingEndpoints.HTTPS,
            correctClockSkew: true,
            logger: formValues.logAwsSdkCalls ? console : undefined,
        });

        const getIceServerConfigResponse = await signalingChannelsClient.send(
            new AWS.KinesisVideoSignaling.GetIceServerConfigCommand({
                ChannelARN: channelARN,
            }),
        );
        if (!isCurrentRun(runToken)) {
            return;
        }

        const iceServers = buildIceServers(formValues, getIceServerConfigResponse.IceServerList || []);
        logInfo('Using ICE servers:', iceServers.map((iceServer) => ({urls: iceServer.urls})));

        appState.peerConnection = new RTCPeerConnection({
            iceServers,
            iceTransportPolicy: formValues.forceTURN ? 'relay' : 'all',
        });
        appState.peerStatus = appState.peerConnection.connectionState || 'new';
        appState.iceStatus = appState.peerConnection.iceConnectionState || 'new';
        updateStatusPanel();

        bindPeerConnectionEvents(appState.peerConnection, formValues, runToken);

        appState.audioTransceiver = appState.peerConnection.addTransceiver('audio', {direction: 'recvonly'});
        applyAudioCodecPreferences(appState.audioTransceiver);

        if (formValues.openDataChannel) {
            appState.localDataChannel = appState.peerConnection.createDataChannel('kvsDataChannel');
            bindDataChannel(appState.localDataChannel, 'viewer');
        }

        appState.signalingClient = new KVSWebRTC.SignalingClient({
            channelARN,
            channelEndpoint: appState.signalingEndpoints.WSS,
            clientId: formValues.clientId,
            role: KVSWebRTC.Role.VIEWER,
            region: formValues.region,
            credentials: {
                accessKeyId: formValues.accessKeyId,
                secretAccessKey: formValues.secretAccessKey,
                sessionToken: formValues.sessionToken,
            },
            requestSigner: {
                getSignedURL: async (signalingEndpoint, queryParams, date) => {
                    const signer = new KVSWebRTC.SigV4RequestSigner(formValues.region, {
                        accessKeyId: formValues.accessKeyId,
                        secretAccessKey: formValues.secretAccessKey,
                        sessionToken: formValues.sessionToken,
                    });
                    return signer.getSignedURL(signalingEndpoint, queryParams, date);
                },
            },
            systemClockOffset: appState.kinesisVideoClient.config.systemClockOffset,
        });

        bindSignalingClientEvents(appState.signalingClient, appState.peerConnection, formValues, runToken);

        appState.sessionStatus = 'Connecting to signaling service...';
        appState.signalingStatus = 'connecting';
        appState.signalingClient.open();
        appState.isStarting = false;
        updateStatusPanel();
        updateControlState();
    } catch (error) {
        console.error('Encountered error while starting the viewer.', error);
        stopViewer({suppressLog: true});
        appState.sessionStatus = 'Failed to start viewer.';
        updateStatusPanel();
        logError('Viewer startup failed.');
    }
}

function bindSignalingClientEvents(signalingClient, peerConnection, formValues, runToken) {
    signalingClient.on('open', async () => {
        if (!isCurrentRun(runToken)) {
            return;
        }

        try {
            appState.signalingStatus = 'connected';
            appState.sessionStatus = 'Creating SDP offer...';
            updateStatusPanel();

            const offer = await peerConnection.createOffer();
            if (!isCurrentRun(runToken)) {
                return;
            }

            await peerConnection.setLocalDescription(offer);
            if (!isCurrentRun(runToken)) {
                return;
            }

            if (formValues.useTrickleICE) {
                logInfo('Sending SDP offer.');
                signalingClient.sendSdpOffer(peerConnection.localDescription);
                appState.sessionStatus = 'Waiting for SDP answer...';
                updateStatusPanel();
            } else {
                appState.sessionStatus = 'Gathering ICE candidates before sending offer...';
                updateStatusPanel();
            }
        } catch (error) {
            console.error('Failed to create or send the SDP offer.', error);
        }
    });

    signalingClient.on('sdpAnswer', async (answer) => {
        if (!isCurrentRun(runToken)) {
            return;
        }

        try {
            logInfo('Received SDP answer.');
            await peerConnection.setRemoteDescription(answer);
            appState.sessionStatus = 'Connected to master. Waiting for audio and data.';
            updateStatusPanel();
        } catch (error) {
            console.error('Failed to apply SDP answer.', error);
        }
    });

    signalingClient.on('iceCandidate', async (candidate) => {
        if (!isCurrentRun(runToken)) {
            return;
        }

        try {
            if (shouldAcceptCandidate(formValues, candidate)) {
                await peerConnection.addIceCandidate(candidate);
                logInfo('Accepted remote ICE candidate.');
            } else {
                logInfo('Ignored remote ICE candidate based on filter settings.');
            }
        } catch (error) {
            console.error('Failed to add remote ICE candidate.', error);
        }
    });

    signalingClient.on('close', () => {
        if (!appState.active) {
            return;
        }
        appState.signalingStatus = 'closed';
        appState.sessionStatus = 'Signaling connection closed.';
        updateStatusPanel();
        logInfo('Signaling connection closed.');
    });

    signalingClient.on('error', (error) => {
        console.error('Signaling client error.', error);
        appState.signalingStatus = 'error';
        appState.sessionStatus = 'Signaling error.';
        updateStatusPanel();
    });
}

function bindPeerConnectionEvents(peerConnection, formValues, runToken) {
    peerConnection.addEventListener('icecandidate', ({candidate}) => {
        if (!isCurrentRun(runToken)) {
            return;
        }

        if (candidate && candidate.candidate) {
            if (formValues.useTrickleICE) {
                if (shouldSendIceCandidate(formValues, candidate)) {
                    appState.signalingClient?.sendIceCandidate(candidate);
                    logInfo('Sent local ICE candidate.');
                } else {
                    logInfo('Skipped local ICE candidate based on filter settings.');
                }
            }
            return;
        }

        if (!formValues.useTrickleICE && peerConnection.localDescription) {
            logInfo('ICE gathering complete. Sending SDP offer.');
            appState.signalingClient?.sendSdpOffer(peerConnection.localDescription);
            appState.sessionStatus = 'Waiting for SDP answer...';
            updateStatusPanel();
        }
    });

    peerConnection.addEventListener('connectionstatechange', () => {
        appState.peerStatus = peerConnection.connectionState || 'unknown';
        if (peerConnection.connectionState === 'connected') {
            appState.sessionStatus = 'Peer connection established. Waiting for audio and data.';
        } else if (peerConnection.connectionState === 'failed') {
            appState.sessionStatus = 'Peer connection failed.';
        } else if (peerConnection.connectionState === 'closed') {
            appState.sessionStatus = 'Peer connection closed.';
        }
        updateStatusPanel();
        logInfo('Peer connection state changed to', peerConnection.connectionState || 'unknown');
    });

    peerConnection.addEventListener('iceconnectionstatechange', () => {
        appState.iceStatus = peerConnection.iceConnectionState || 'unknown';
        updateStatusPanel();
        logInfo('ICE connection state changed to', peerConnection.iceConnectionState || 'unknown');
    });

    peerConnection.addEventListener('track', (event) => {
        if (event.track.kind !== 'audio') {
            logInfo('Ignoring non-audio remote track.', event.track.kind);
            return;
        }

        logInfo('Received remote audio track.', {
            streamId: event.streams?.[0]?.id,
            trackId: event.track.id,
        });

        if (event.streams && event.streams[0]) {
            appState.remoteStream = event.streams[0];
        } else {
            if (!appState.remoteStream) {
                appState.remoteStream = new MediaStream();
            }
            appState.remoteStream.addTrack(event.track);
        }

        elements.remoteAudio.srcObject = appState.remoteStream;
        appState.audioStatus = 'receiving';
        appState.sessionStatus = 'Receiving remote audio.';
        updateStatusPanel();

        void playRemoteAudio();

        event.track.addEventListener('ended', () => {
            appState.audioStatus = 'ended';
            updateStatusPanel();
        });
    });

    peerConnection.addEventListener('datachannel', (event) => {
        if (!isCurrentRun(runToken)) {
            return;
        }
        bindDataChannel(event.channel, 'master');
    });
}

function applyAudioCodecPreferences(audioTransceiver) {
    if (!audioTransceiver || typeof audioTransceiver.setCodecPreferences !== 'function') {
        return;
    }

    const selectedMimeTypes = elements.codecFilterToggle.checked
        ? Array.from(document.querySelectorAll('input[name="acodec"]:checked')).map((checkbox) => checkbox.value)
        : [];

    if (!selectedMimeTypes.length) {
        logInfo('Audio codec filter disabled or no codecs selected. Browser defaults will be used.');
        return;
    }

    const selectedCodecs = selectedMimeTypes.flatMap((mimeType) => {
        return audioCodecCapabilities.filter((codec) => codec.mimeType === mimeType);
    });

    audioTransceiver.setCodecPreferences(selectedCodecs);
    logInfo('Applied audio codec preferences:', selectedMimeTypes);
}

function buildIceServers(formValues, iceServerList) {
    const iceServers = [];

    if (!formValues.natTraversalDisabled && !formValues.forceTURN && formValues.sendSrflxCandidates) {
        if (formValues.useDualStackEndpoints) {
            iceServers.push({urls: `stun:stun.kinesisvideo.${formValues.region}.api.aws:443`});
        } else {
            iceServers.push({urls: `stun:stun.kinesisvideo.${formValues.region}.amazonaws.com:443`});
        }
    }

    if (!formValues.natTraversalDisabled && !formValues.forceSTUN) {
        let turnServers = iceServerList.map((iceServer) => {
            return {
                urls: (iceServer.Uris || []).filter((url) => isTurnUrlAllowed(url, formValues)),
                username: iceServer.Username,
                credential: iceServer.Password,
            };
        }).filter((server) => server.urls.length > 0);

        if (formValues.oneTurnServerSetOnly && turnServers.length > 1) {
            turnServers = [turnServers[Math.floor(Math.random() * turnServers.length)]];
        }

        iceServers.push(...turnServers);
    }

    return iceServers;
}

function isTurnUrlAllowed(url, formValues) {
    if (url.startsWith('turn:') && url.endsWith('?transport=udp')) {
        return formValues.turnWithUdp;
    }
    if (url.startsWith('turns:') && url.endsWith('?transport=udp')) {
        return formValues.turnsWithUdp;
    }
    if (url.startsWith('turns:') && url.endsWith('?transport=tcp')) {
        return formValues.turnsWithTcp;
    }
    return true;
}

function shouldAcceptCandidate(formValues, candidate) {
    const parsedCandidate = extractTransportAndType(candidate);
    if (!parsedCandidate) {
        return false;
    }

    const {transport, type} = parsedCandidate;
    if (!formValues.acceptUdpCandidates && transport === 'udp') {
        return false;
    }
    if (!formValues.acceptTcpCandidates && transport === 'tcp') {
        return false;
    }

    switch (type) {
        case 'host':
            return formValues.acceptHostCandidates;
        case 'srflx':
            return formValues.acceptSrflxCandidates;
        case 'relay':
            return formValues.acceptRelayCandidates;
        case 'prflx':
            return formValues.acceptPrflxCandidates;
        default:
            return false;
    }
}

function shouldSendIceCandidate(formValues, candidate) {
    const parsedCandidate = extractTransportAndType(candidate);
    if (!parsedCandidate) {
        return false;
    }

    const {transport, type} = parsedCandidate;
    if (!formValues.sendUdpCandidates && transport === 'udp') {
        return false;
    }
    if (!formValues.sendTcpCandidates && transport === 'tcp') {
        return false;
    }

    switch (type) {
        case 'host':
            return formValues.sendHostCandidates;
        case 'srflx':
            return formValues.sendSrflxCandidates;
        case 'relay':
            return formValues.sendRelayCandidates;
        case 'prflx':
            return formValues.sendPrflxCandidates;
        default:
            return false;
    }
}

function extractTransportAndType(candidate) {
    const candidateLine = candidate?.candidate;
    if (!candidateLine) {
        return null;
    }

    const parts = candidateLine.split(' ');
    if (parts.length < 8) {
        console.warn('Invalid ICE candidate format.', candidateLine);
        return null;
    }

    return {
        transport: parts[2],
        type: parts[7],
    };
}

function bindDataChannel(dataChannel, origin) {
    const channelKey = `${origin}:${dataChannel.label || 'data'}:${appState.dataChannels.size + 1}`;
    appState.dataChannels.set(channelKey, dataChannel);
    dataChannel.binaryType = 'arraybuffer';
    appState.lastDataChannelStatus = dataChannel.readyState || 'connecting';
    updateStatusPanel();

    logInfo(`Registered ${origin} data channel.`, {
        label: dataChannel.label,
        readyState: dataChannel.readyState,
    });

    dataChannel.addEventListener('open', () => {
        appState.lastDataChannelStatus = 'open';
        updateStatusPanel();
        appState.sessionStatus = 'Data channel open.';
        logInfo(`Data channel opened (${dataChannel.label || 'data'}).`);
    });

    dataChannel.addEventListener('close', () => {
        appState.dataChannels.delete(channelKey);
        appState.lastDataChannelStatus = 'closed';
        updateStatusPanel();
        logInfo(`Data channel closed (${dataChannel.label || 'data'}).`);
    });

    dataChannel.addEventListener('error', (error) => {
        console.error(`Data channel error (${dataChannel.label || 'data'}).`, error);
        appState.lastDataChannelStatus = 'error';
        updateStatusPanel();
    });

    dataChannel.addEventListener('message', (event) => {
        void handleDataChannelMessage(dataChannel, event);
    });
}

async function handleDataChannelMessage(dataChannel, event) {
    const receivedAt = Date.now();
    const text = await convertDataChannelPayloadToText(event.data);
    const plotPoints = extractPlotPoints(text, receivedAt);

    appState.receivedMessageCount += 1;
    appState.receivedEntries.push(
        `[${formatTimestamp(receivedAt)}] ${dataChannel.label || 'data'}\n${text}`,
    );
    if (appState.receivedEntries.length > MAX_RECEIVED_MESSAGE_ENTRIES) {
        appState.receivedEntries.splice(0, appState.receivedEntries.length - MAX_RECEIVED_MESSAGE_ENTRIES);
    }

    renderReceivedMessages();

    if (plotPoints.length) {
        addPlotPoints(plotPoints);
    } else {
        updatePlotStatus('Received data that did not match the numeric JSON plotting format.');
    }

    updateStatusPanel();
}

async function convertDataChannelPayloadToText(payload) {
    if (typeof payload === 'string') {
        return payload;
    }

    if (payload instanceof Blob) {
        return payload.text();
    }

    if (payload instanceof ArrayBuffer) {
        return new TextDecoder().decode(payload);
    }

    if (ArrayBuffer.isView(payload)) {
        return new TextDecoder().decode(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength));
    }

    return String(payload);
}

function extractPlotPoints(rawText, receivedAt) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        return [];
    }

    return normalizePlotPayload(parsed, receivedAt, '');
}

function normalizePlotPayload(payload, receivedAt, prefix) {
    if (Array.isArray(payload)) {
        return payload.flatMap((item) => normalizePlotPayload(item, receivedAt, prefix));
    }

    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const payloadTimestamp = normalizeTimestamp(
        payload.timestamp ?? payload.ts ?? payload.time ?? payload.date ?? payload.datetime,
        receivedAt,
    );

    if (payload.paramId !== undefined && payload.value !== undefined) {
        const point = createPlotPoint(payload.paramId, payload.value, payloadTimestamp, receivedAt);
        return point ? [point] : [];
    }

    if (Array.isArray(payload.samples)) {
        return payload.samples.flatMap((item) => normalizePlotPayload(item, receivedAt, prefix));
    }

    if (payload.values && typeof payload.values === 'object' && !Array.isArray(payload.values)) {
        return Object.entries(payload.values).flatMap(([key, value]) => {
            const point = createPlotPoint(prefix ? `${prefix}.${key}` : key, value, payloadTimestamp, receivedAt);
            return point ? [point] : [];
        });
    }

    return Object.entries(payload).flatMap(([key, value]) => {
        if (PLOT_RESERVED_KEYS.has(key)) {
            return [];
        }

        const seriesId = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object') {
            return normalizePlotPayload(value, receivedAt, seriesId);
        }

        const point = createPlotPoint(seriesId, value, payloadTimestamp, receivedAt);
        return point ? [point] : [];
    });
}

function createPlotPoint(seriesId, rawValue, timestamp, receivedAt) {
    const normalizedSeriesId = String(seriesId || '').trim();
    if (!normalizedSeriesId) {
        return null;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    const normalizedTimestamp = normalizeTimestamp(timestamp, receivedAt);
    return {
        seriesId: normalizedSeriesId,
        value: numericValue,
        timestamp: normalizedTimestamp,
        latencyMs: Math.max(0, receivedAt - normalizedTimestamp),
    };
}

function normalizeTimestamp(rawTimestamp, fallback) {
    if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
        return rawTimestamp;
    }

    if (typeof rawTimestamp === 'string') {
        const numericTimestamp = Number(rawTimestamp);
        if (Number.isFinite(numericTimestamp)) {
            return numericTimestamp;
        }

        const dateTimestamp = Date.parse(rawTimestamp);
        if (Number.isFinite(dateTimestamp)) {
            return dateTimestamp;
        }
    }

    return fallback;
}

function addPlotPoints(plotPoints) {
    plotPoints.forEach((point) => {
        if (!appState.plotSeries[point.seriesId]) {
            appState.plotSeries[point.seriesId] = [];
            appState.plotSeriesOrder.push(point.seriesId);
        }

        appState.plotSeries[point.seriesId].push({
            timestamp: point.timestamp,
            value: point.value,
            latencyMs: point.latencyMs,
        });
        appState.latestPlotTimestamp = Math.max(appState.latestPlotTimestamp, point.timestamp);
    });

    prunePlotData();
    syncPlotChart();
}

function prunePlotData() {
    const cutoff = getPlotWindowEnd() - PLOT_WINDOW_MS;
    Object.keys(appState.plotSeries).forEach((seriesId) => {
        appState.plotSeries[seriesId] = appState.plotSeries[seriesId].filter((point) => point.timestamp >= cutoff);
    });
}

function getPlotWindowEnd() {
    return Math.max(Date.now(), appState.latestPlotTimestamp || 0);
}

function initializePlotChart() {
    if (!elements.plotCanvas) {
        return;
    }

    if (appState.plotChart) {
        appState.plotChart.destroy();
    }

    const context = elements.plotCanvas.getContext('2d');
    if (!context) {
        return;
    }

    appState.plotChart = new Chart(context, {
        type: 'line',
        data: {
            datasets: [],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            normalized: true,
            parsing: false,
            interaction: {
                mode: 'nearest',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    align: 'start',
                },
                tooltip: {
                    callbacks: {
                        title: (tooltipItems) => {
                            if (!tooltipItems.length) {
                                return '';
                            }
                            return `Time ${formatTimestamp(tooltipItems[0].parsed.x)}`;
                        },
                        label: (tooltipItem) => {
                            const rawPoint = tooltipItem.raw || {};
                            const latencyText = Number.isFinite(rawPoint.latencyMs)
                                ? `${Math.round(rawPoint.latencyMs)} ms`
                                : 'n/a';
                            return `${tooltipItem.dataset.label}: ${tooltipItem.parsed.y} | latency ${latencyText}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Timestamp',
                    },
                    ticks: {
                        callback: (value) => formatAxisTime(value),
                        maxTicksLimit: 6,
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: 'Value',
                    },
                },
            },
        },
    });
}

function syncPlotChart() {
    if (!appState.plotChart) {
        return;
    }

    const windowEnd = getPlotWindowEnd();
    const windowStart = windowEnd - PLOT_WINDOW_MS;

    const visibleSeries = appState.plotSeriesOrder
        .map((seriesId) => {
            return {
                seriesId,
                color: getSeriesColor(seriesId),
                points: (appState.plotSeries[seriesId] || []).filter((point) => point.timestamp >= windowStart),
            };
        })
        .filter((series) => series.points.length > 0);

    appState.plotChart.data.datasets = visibleSeries.map((series) => {
        return {
            label: series.seriesId,
            data: series.points.map((point) => ({
                x: point.timestamp,
                y: point.value,
                latencyMs: point.latencyMs,
            })),
            borderColor: series.color,
            backgroundColor: series.color,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: true,
            tension: 0.18,
        };
    });
    appState.plotChart.options.scales.x.min = windowStart;
    appState.plotChart.options.scales.x.max = windowEnd;

    if (!visibleSeries.length) {
        appState.plotChart.options.scales.y.min = undefined;
        appState.plotChart.options.scales.y.max = undefined;
        appState.plotChart.update('none');
        if (!appState.active) {
            updatePlotStatus('Waiting for numeric JSON data.');
        } else {
            updatePlotStatus(appState.expectDataChannel ? 'Waiting for numeric JSON data.' : 'Data channel negotiation is disabled.');
        }
        return;
    }

    const values = visibleSeries.flatMap((series) => series.points.map((point) => point.value));
    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);
    if (minValue === maxValue) {
        minValue -= 1;
        maxValue += 1;
    }
    appState.plotChart.options.scales.y.min = minValue;
    appState.plotChart.options.scales.y.max = maxValue;
    appState.plotChart.update('none');

    const latestValues = visibleSeries.map((series) => {
        const latestPoint = series.points[series.points.length - 1];
        return `${series.seriesId}=${latestPoint.value}`;
    }).join(' | ');
    updatePlotStatus(`Showing last 60 seconds. ${latestValues}`);
}

function getSeriesColor(seriesId) {
    const seriesIndex = appState.plotSeriesOrder.indexOf(seriesId);
    return PLOT_COLORS[seriesIndex % PLOT_COLORS.length];
}

function updatePlotStatus(message) {
    elements.plotStatus.textContent = message;
}

function renderReceivedMessages() {
    elements.receivedDataLog.value = appState.receivedEntries.join('\n\n');
    elements.receivedDataLog.scrollTop = elements.receivedDataLog.scrollHeight;
    elements.receivedDataSummary.textContent = appState.receivedMessageCount
        ? `Received ${appState.receivedMessageCount} message${appState.receivedMessageCount === 1 ? '' : 's'}.`
        : 'No data received.';
    elements.statusMessages.textContent = String(appState.receivedMessageCount);
}

function clearReceivedData(options = {}) {
    appState.receivedEntries = [];
    appState.receivedMessageCount = 0;
    appState.plotSeries = {};
    appState.plotSeriesOrder = [];
    appState.latestPlotTimestamp = 0;
    renderReceivedMessages();
    syncPlotChart();

    if (!options.suppressLog) {
        updatePlotStatus('Waiting for numeric JSON data.');
    }
}

async function playRemoteAudio() {
    try {
        await elements.remoteAudio.play();
    } catch (error) {
        console.warn('Audio playback did not start automatically.', error);
    }
}

function stopViewer(options = {}) {
    const suppressLog = Boolean(options.suppressLog);
    const wasActive = appState.active || appState.isStarting;
    activeRunToken += 1;

    const dataChannels = Array.from(appState.dataChannels.values());
    dataChannels.forEach((dataChannel) => {
        try {
            dataChannel.close();
        } catch (error) {
            originalConsole.warn('Unable to close data channel.', error);
        }
    });
    appState.dataChannels.clear();
    appState.localDataChannel = null;

    if (appState.signalingClient) {
        try {
            appState.signalingClient.close();
        } catch (error) {
            originalConsole.warn('Unable to close signaling client.', error);
        }
    }

    if (appState.peerConnection) {
        try {
            appState.peerConnection.close();
        } catch (error) {
            originalConsole.warn('Unable to close peer connection.', error);
        }
    }

    if (appState.remoteStream) {
        try {
            appState.remoteStream.getTracks().forEach((track) => track.stop());
        } catch (error) {
            originalConsole.warn('Unable to stop remote tracks.', error);
        }
    }

    elements.remoteAudio.pause();
    elements.remoteAudio.srcObject = null;

    appState.active = false;
    appState.isStarting = false;
    appState.runToken = 0;
    appState.expectDataChannel = false;
    appState.signalingClient = null;
    appState.peerConnection = null;
    appState.kinesisVideoClient = null;
    appState.signalingEndpoints = null;
    appState.remoteStream = null;
    appState.audioTransceiver = null;
    appState.lastDataChannelStatus = 'idle';
    appState.signalingStatus = 'idle';
    appState.peerStatus = 'idle';
    appState.iceStatus = 'idle';
    appState.audioStatus = 'waiting';
    appState.sessionStatus = 'Idle.';
    appState.activeClientId = '-';

    updateStatusPanel();
    updateControlState();

    if (!suppressLog && wasActive) {
        logInfo('Stopped viewer.');
    }
}

function updateStatusPanel() {
    elements.sessionStatus.textContent = appState.sessionStatus;
    elements.statusClientId.textContent = appState.activeClientId;
    elements.statusSignaling.textContent = appState.signalingStatus;
    elements.statusPeer.textContent = appState.peerStatus;
    elements.statusIce.textContent = appState.iceStatus;
    elements.statusDataChannel.textContent = summarizeDataChannelStatus();
    elements.statusAudio.textContent = appState.audioStatus;
    elements.statusMessages.textContent = String(appState.receivedMessageCount);
}

function summarizeDataChannelStatus() {
    if (!appState.dataChannels.size) {
        if (appState.active) {
            return appState.expectDataChannel ? appState.lastDataChannelStatus : 'disabled';
        }
        return 'idle';
    }

    return Array.from(appState.dataChannels.values())
        .map((dataChannel) => `${dataChannel.label || 'data'}:${dataChannel.readyState}`)
        .join(', ');
}

function updateControlState() {
    elements.startButton.disabled = appState.active || appState.isStarting;
    elements.stopButton.disabled = !appState.active && !appState.isStarting;
}

function appendApplicationLog(level, messages) {
    const formattedLine = `[${new Date().toISOString()}] [${level}] ${messages.map(formatLogValue).join(' ')}`;
    appState.applicationLogLines.push(formattedLine);
    if (appState.applicationLogLines.length > MAX_APPLICATION_LOG_LINES) {
        appState.applicationLogLines.splice(0, appState.applicationLogLines.length - MAX_APPLICATION_LOG_LINES);
    }
    renderApplicationLog();
}

function renderApplicationLog() {
    if (!elements.applicationLog) {
        return;
    }
    elements.applicationLog.value = appState.applicationLogLines.join('\n');
    elements.applicationLog.scrollTop = elements.applicationLog.scrollHeight;
}

function formatLogValue(value) {
    if (value instanceof Error) {
        return value.stack || value.message || String(value);
    }

    if (typeof value === 'object' && value !== null) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return String(value);
        }
    }

    if (value === undefined) {
        return 'undefined';
    }

    return String(value);
}

function logInfo(...messages) {
    console.log(...messages);
}

function logError(...messages) {
    console.error(...messages);
}

function maskSecret(secret) {
    if (!secret) {
        return secret;
    }
    return '*'.repeat(secret.length);
}

function getRandomClientId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2);
    return `${timestamp}-${random}`;
}

function getTabScopedClientId() {
    try {
        let storedClientId = sessionStorage.getItem('viewer-client-id');
        if (!storedClientId) {
            storedClientId = getRandomClientId();
            sessionStorage.setItem('viewer-client-id', storedClientId);
        }
        return storedClientId;
    } catch (error) {
        return getRandomClientId();
    }
}

function isCurrentRun(runToken) {
    return runToken === activeRunToken && runToken === appState.runToken;
}

function formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString();
}

function formatAxisTime(timestamp) {
    return new Date(timestamp).toISOString().slice(11, 19);
}
