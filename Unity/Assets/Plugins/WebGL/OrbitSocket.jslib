mergeInto(LibraryManager.library, {
    OrbitConnect: function (objPtr) {
        var target = UTF8ToString(objPtr);
        var canvas = Module.canvas;
        if (window.orbitControls) window.orbitControls.dispose();
        if (window.orbitSocket) {
            window.orbitSocket.onopen = window.orbitSocket.onmessage = window.orbitSocket.onclose = window.orbitSocket.onerror = null;
            window.orbitSocket.close();
        }

        var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
        var ws = new WebSocket(url);
        window.orbitSocket = ws;
        var network = window.orbitNetwork = { pending: null, latest: 0, acknowledged: 0, sentAck: 0, ackQueued: false };
        function collect(frame) {
            if (frame.seq !== network.latest + 1) { ws.close(1002, 'State sequence gap'); return; }
            network.latest = frame.seq;
            if (frame.full || !network.pending) network.pending = { header: {}, players: {}, poses: {}, deposits: {}, stations: {}, bolts: {}, removed: {}, removedBolts: {}, events: [] };
            var pending = network.pending;
            for (var key in frame) {
                if (key === 'players' || key === 'poses' || key === 'deposits' || key === 'stations' || key === 'bolts') {
                    frame[key].forEach(function (row) { pending[key][row.id] = row; });
                } else if (key === 'removedPlayers') {
                    frame[key].forEach(function (id) { pending.removed[id] = true; delete pending.players[id]; delete pending.poses[id]; });
                } else if (key === 'removedBolts') {
                    frame[key].forEach(function (id) { pending.removedBolts[id] = true; delete pending.bolts[id]; });
                } else if (key === 'events') pending.events.push.apply(pending.events, frame.events);
                else if (key !== 'full' || frame.full) pending.header[key] = frame[key];
            }
            if (pending.events.length > 2048) { ws.close(1013, 'State consumer unavailable'); network.pending = null; }
        }
        network.poll = function () {
            if (!network.pending) return;
            var pending = network.pending; network.pending = null;
            if (typeof pending === 'string') { SendMessage(target, 'SocketMessage', pending); return; }
            var packet = pending.header;
            ['players','poses','deposits','stations','bolts'].forEach(function (key) {
                var rows = Object.keys(pending[key]).map(function (id) { return pending[key][id]; });
                if (rows.length || packet.full) packet[key] = rows;
            });
            var removed = Object.keys(pending.removed); if (removed.length) packet.removedPlayers = removed;
            var removedBolts = Object.keys(pending.removedBolts); if (removedBolts.length) packet.removedBolts = removedBolts;
            packet.events = pending.events;
            SendMessage(target, 'SocketMessage', JSON.stringify(packet));
            // Ack means Unity consumed the frame, not merely that the browser received bytes.
            network.acknowledged = packet.seq;
            // The normal input sent later in this Unity frame carries this ACK.
            // If no input is due, release stream credit without waiting up to 50ms.
            if (!network.ackQueued) {
                network.ackQueued = true;
                Promise.resolve().then(function () {
                    network.ackQueued = false;
                    if (window.orbitSocket !== ws || ws.readyState !== 1 || ws.bufferedAmount >= 8192 ||
                        network.sentAck >= network.acknowledged) return;
                    ws.send(JSON.stringify({ type: 'ack', ack: network.acknowledged }));
                    network.sentAck = network.acknowledged;
                });
            }
        };
        var drag = false;
        var dragInside = false;
        var lookX = 0;
        var lookY = 0;
        var reportedPointerError = false;
        var pointerPending = false;
        var rightHeld = false;
        var dragX = 0, dragY = 0;
        var wheelEnabled = false, wheelSteps = 0, wheelPixels = 0, wheelAt = 0, wheelThreshold = 50, wheelDirection = 0;

        function clearWheel() { wheelSteps = wheelPixels = wheelAt = wheelDirection = 0; wheelThreshold = 50; }
        function wheel(event) {
            if (!wheelEnabled || window.orbitSurveyOpen || document.hidden || !document.hasFocus() ||
                document.activeElement !== canvas && document.pointerLockElement !== canvas || event.ctrlKey) {
                clearWheel(); return;
            }
            var mode = event.deltaMode, delta = event.deltaY;
            if (!Number.isFinite(delta) || Math.abs(delta) <= Math.abs(event.deltaX)) return;
            event.preventDefault();
            var now = performance.now(), direction = Math.sign(delta), amount = Math.abs(delta);
            if (now - wheelAt > 180 || wheelDirection !== direction) { wheelPixels = 0; wheelThreshold = 50; }
            wheelAt = now; wheelDirection = direction;
            // Detented mice commonly report 100/120 pixels or 3 lines per notch.
            // Count coalesced notches; smooth gestures accumulate instead of
            // changing equipment on each tiny trackpad/momentum event.
            var notches = mode === 1 ? amount / 3 : mode === 2 ? amount :
                amount >= 100 && amount % 100 === 0 ? amount / 100 :
                amount >= 120 && amount % 120 === 0 ? amount / 120 : 0;
            if (notches >= 1) {
                wheelSteps += direction * Math.min(32, Math.floor(notches));
                wheelPixels = 0;
            } else {
                wheelPixels += delta * (mode === 1 ? 100 / 3 : 1);
                if (Math.abs(wheelPixels) >= wheelThreshold) {
                    var steps = 1 + Math.floor((Math.abs(wheelPixels) - wheelThreshold) / 100);
                    wheelSteps += direction * Math.min(32, steps);
                    wheelPixels -= direction * (wheelThreshold + (steps - 1) * 100);
                    wheelThreshold = 100;
                }
            }
        }

        function clearLook() {
            drag = false;
            dragInside = false;
            lookX = lookY = 0;
        }

        function pointerChanged() {
            clearLook();
            var captured = document.pointerLockElement === canvas;
            pointerPending = false;
            SendMessage(target, 'PointerChanged', captured ? '1' : '0');
        }

        function pointerFailed(error) {
            if (document.pointerLockElement === canvas) { pointerChanged(); return; }
            pointerPending = false;
            lookX = lookY = 0;
            SendMessage(target, 'PointerChanged', '0');
            SendMessage(target, 'PointerUnavailable', '');
            if (reportedPointerError) return;
            reportedPointerError = true;
            console.info('Pointer lock unavailable:', error && error.name, error && error.message);
        }

        function requestPointer() {
            if (!canvas.requestPointerLock) { pointerFailed({ name: 'NotSupportedError' }); return; }
            if (pointerPending || document.pointerLockElement === canvas) return;
            pointerPending = true;
            canvas.focus();
            try {
                var request = canvas.requestPointerLock();
                if (request && request.catch) request.catch(pointerFailed);
            } catch (error) {
                pointerFailed(error);
            }
        }

        function mouseDown(event) {
            if (window.orbitSurveyOpen) return;
            if (event.button === 2) {
                event.preventDefault();
                rightHeld = true;
                if (document.pointerLockElement !== canvas) SendMessage(target, 'PointerAcquirePressed', 'right');
                drag = true;
                dragInside = true;
                dragX = event.clientX; dragY = event.clientY;
                requestPointer();
                return;
            }
            if (event.button === 0) {
                if (document.pointerLockElement !== canvas) SendMessage(target, 'PointerAcquirePressed', '');
                requestPointer();
            }
        }

        function surveyKeyDown(event) {
            if (event.key === 'Escape') window.orbitSurveyRestore = false;
            if (event.key === 'Tab' || event.key === 'Escape') { wheelEnabled = false; clearWheel(); }
        }

        function surveyKeyUp(event) {
            if (event.key !== 'Tab' || !window.orbitSurveyOpen) return;
            window.orbitSurveyOpen = false;
            if (window.orbitSurveyRestore && document.hasFocus()) requestPointer();
            window.orbitSurveyRestore = false;
        }

        function loseFocus() {
            wheelEnabled = false; clearWheel();
            rightHeld = false;
            clearLook();
            window.orbitSurveyRestore = false;
        }

        function pointerUp(event) {
            if (event.button === 2) { drag = false; rightHeld = false; }
        }

        function cancelPointerGesture() {
            var active = drag || rightHeld;
            rightHeld = false;
            clearLook();
            if (active) SendMessage(target, 'PointerGestureCancelled', '');
        }

        function leaveCanvas() { dragInside = false; }
        function leaveDocument(event) { if (event.relatedTarget === null) leaveCanvas(); }
        function enterCanvas(event) {
            dragInside = true;
            // Desktop travel outside the canvas is not camera movement. Resume
            // a held drag from this boundary, without capping in-game fast aim.
            dragX = event.clientX; dragY = event.clientY;
            if (drag && (event.buttons & 2) === 0) cancelPointerGesture();
        }

        function move(event) {
            if (window.orbitSurveyOpen) return;
            if (document.hidden || !document.hasFocus()) return;
            var captured = document.pointerLockElement === canvas;
            // pointerup only reports the final button of a chord. A release
            // outside this document can also be missed: trust the current
            // physical buttons before using the old right-drag anchor.
            if ((drag || rightHeld) && (event.buttons & 2) === 0) {
                if (!captured) { cancelPointerGesture(); return; }
                rightHeld = drag = false;
                SendMessage(target, 'PointerGestureCancelled', '');
            }
            if (!captured && (!drag || !dragInside)) return;
            var dx, dy;
            if (captured) {
                dx = event.movementX; dy = event.movementY;
            } else {
                // Unlocked right-drag is a separate coordinate space. Its first
                // delta starts at pointerdown, never at the previous desktop cursor.
                dx = event.clientX - dragX; dy = event.clientY - dragY;
                dragX = event.clientX; dragY = event.clientY;
            }
            if (Number.isFinite(dx) && Number.isFinite(dy)) { lookX += dx; lookY += dy; }
        }

        function contextMenu(event) {
            event.preventDefault();
        }

        // Mouse events report each button of a chord, unlike pointerdown/up.
        canvas.addEventListener('mousedown', mouseDown);
        canvas.addEventListener('mouseenter', enterCanvas);
        canvas.addEventListener('mouseleave', leaveCanvas);
        canvas.addEventListener('contextmenu', contextMenu);
        canvas.addEventListener('wheel', wheel, { passive: false });
        document.addEventListener('mouseup', pointerUp, true);
        document.addEventListener('pointercancel', cancelPointerGesture, true);
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseout', leaveDocument, true);
        document.addEventListener('pointerlockchange', pointerChanged);
        document.addEventListener('pointerlockerror', pointerFailed);
        document.addEventListener('keydown', surveyKeyDown, true);
        document.addEventListener('keyup', surveyKeyUp, true);
        window.addEventListener('blur', loseFocus);
        document.addEventListener('visibilitychange', loseFocus);

        window.orbitControls = {
            rightHeld: function () { return rightHeld; },
            readWheel: function (enabled) {
                wheelEnabled = !!enabled;
                var steps = enabled ? wheelSteps : 0;
                wheelSteps = 0;
                if (!enabled) clearWheel();
                return steps;
            },
            releaseButtons: function () { rightHeld = false; clearLook(); },
            readX: function () { var value = lookX; lookX = 0; return value; },
            readY: function () { var value = lookY; lookY = 0; return value; },
            dispose: function () {
                canvas.removeEventListener('mousedown', mouseDown);
                canvas.removeEventListener('mouseenter', enterCanvas);
                canvas.removeEventListener('mouseleave', leaveCanvas);
                canvas.removeEventListener('contextmenu', contextMenu);
                canvas.removeEventListener('wheel', wheel);
                document.removeEventListener('mouseup', pointerUp, true);
                document.removeEventListener('pointercancel', cancelPointerGesture, true);
                document.removeEventListener('mousemove', move, true);
                document.removeEventListener('mouseout', leaveDocument, true);
                document.removeEventListener('pointerlockchange', pointerChanged);
                document.removeEventListener('pointerlockerror', pointerFailed);
                document.removeEventListener('keydown', surveyKeyDown, true);
                document.removeEventListener('keyup', surveyKeyUp, true);
                window.removeEventListener('blur', loseFocus);
                document.removeEventListener('visibilitychange', loseFocus);
            }
        };

        ws.onopen = function () { if (window.orbitSocket === ws) SendMessage(target, 'SocketOpened', ''); };
        ws.onmessage = function (event) {
            if (typeof event.data !== 'string' || window.orbitSocket !== ws) return;
            var packet;
            try { packet = JSON.parse(event.data); } catch (_) { ws.close(1007, 'Invalid state'); return; }
            if (packet.type === 'frame') collect(packet);
            else if (packet.type === 'state') network.pending = event.data;
            else SendMessage(target, 'SocketMessage', event.data);
        };
        ws.onclose = function () { if (window.orbitSocket === ws) SendMessage(target, 'SocketClosed', 'Connection lost'); };
        ws.onerror = function () { if (window.orbitSocket === ws) SendMessage(target, 'SocketClosed', 'Station unavailable'); };
    },
    OrbitSend: function (msgPtr) {
        var ws = window.orbitSocket;
        if (ws && ws.readyState === 1 && ws.bufferedAmount < 8192) {
            var text = UTF8ToString(msgPtr);
            var packet = JSON.parse(text);
            if (packet.type === 'input' && window.orbitNetwork) {
                packet.ack = window.orbitNetwork.acknowledged;
                window.orbitNetwork.sentAck = packet.ack;
            }
            ws.send(JSON.stringify(packet));
        }
    },
    OrbitPoll: function () { if (window.orbitNetwork) window.orbitNetwork.poll(); },
    OrbitReadWheel: function (enabled) { return window.orbitControls ? window.orbitControls.readWheel(enabled) : 0; },
    OrbitRightHeld: function () { return window.orbitControls && window.orbitControls.rightHeld() ? 1 : 0; },
    OrbitReadLookX: function () { return window.orbitControls ? window.orbitControls.readX() : 0; },
    OrbitReadLookY: function () { return window.orbitControls ? window.orbitControls.readY() : 0; },
    OrbitRelease: function () { if (window.orbitControls) window.orbitControls.releaseButtons(); if (document.pointerLockElement) document.exitPointerLock(); },
    OrbitSurveyMode: function (open) {
        if (open) window.orbitSurveyRestore = document.pointerLockElement === Module.canvas;
        window.orbitSurveyOpen = !!open;
        if (open && window.orbitControls) window.orbitControls.releaseButtons();
        if (open && document.pointerLockElement) document.exitPointerLock();
        if (window.orbitControls) {
            window.orbitControls.readX();
            window.orbitControls.readY();
        }
    }
});
