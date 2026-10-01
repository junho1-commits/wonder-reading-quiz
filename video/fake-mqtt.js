// 촬영 전용: 외부 MQTT 브로커 없이 같은 브라우저의 교사·학생 페이지를 BroadcastChannel로 연결하는 가짜 mqtt 클라이언트
(function () {
  const bus = new BroadcastChannel('fake-mqtt-bus');
  const RET_KEY = 'fake-mqtt-retained';
  const clients = new Set();

  function loadRetained() {
    try { return JSON.parse(localStorage.getItem(RET_KEY)) || {}; } catch (e) { return {}; }
  }

  function deliver(client, topic, payload) {
    if (client.subs.has(topic)) {
      (client.handlers.message || []).forEach(h => h(topic, { toString: () => payload }));
    }
  }

  bus.onmessage = (ev) => {
    clients.forEach(c => deliver(c, ev.data.topic, ev.data.payload));
  };

  window.mqtt = {
    connect(url, options) {
      const client = {
        options: options || {},
        connected: false,
        subs: new Set(),
        handlers: {},
        on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); return this; },
        subscribe(topic) {
          this.subs.add(topic);
          const ret = loadRetained()[topic];
          if (ret !== undefined) setTimeout(() => deliver(this, topic, ret), 30);
        },
        publish(topic, payload, opts) {
          const text = String(payload);
          if (opts && opts.retain) {
            const r = loadRetained();
            r[topic] = text;
            try { localStorage.setItem(RET_KEY, JSON.stringify(r)); } catch (e) {}
          }
          bus.postMessage({ topic, payload: text });
          // 같은 페이지 안의 다른 클라이언트에는 BroadcastChannel이 전달하지 않으므로 직접 전달
          clients.forEach(c => { if (c !== this) deliver(c, topic, text); });
        },
        reconnect() {}
      };
      clients.add(client);
      setTimeout(() => {
        client.connected = true;
        (client.handlers.connect || []).forEach(h => h());
      }, 20);
      return client;
    }
  };
})();
