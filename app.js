(() => {
  // 簡易ログイン設定。GitHub Pages上ではソースコードから確認できます。
  // これは画面表示を分けるだけで、本格的なアクセス制御ではありません。
  const LOGIN_USERNAME = 'kazoku';
  const LOGIN_PASSWORD = 'password';

  const loginScreen = document.getElementById('loginScreen');
  const appContent = document.getElementById('appContent');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const logoutButton = document.getElementById('logoutButton');

  function showApp() {
    if (loginScreen) loginScreen.hidden = true;
    if (appContent) appContent.hidden = false;
    startMonitorApp();
  }

  function showLogin() {
    if (appContent) appContent.hidden = true;
    if (loginScreen) loginScreen.hidden = false;
    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = document.getElementById('loginUsername')?.value || '';
      const password = document.getElementById('loginPassword')?.value || '';
      if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
        sessionStorage.setItem('indoorMonitorLoggedIn', '1');
        if (loginError) loginError.textContent = '';
        showApp();
      } else if (loginError) {
        loginError.textContent = 'ユーザー名またはパスワードが違います。';
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      sessionStorage.removeItem('indoorMonitorLoggedIn');
      showLogin();
    });
  }

  function startMonitorApp() {
    if (window.monitorAppStarted) return;
    window.monitorAppStarted = true;

    const cfg = window.MONITOR_CONFIG || {};
    const $ = id => document.getElementById(id);
    const labels = {
      1: { title: '室温の推移', legend: '室温（℃）', unit: '℃' },
      2: { title: '湿度の推移', legend: '湿度（%）', unit: '%' },
      3: { title: 'ガスセンサー値の推移', legend: 'ガスセンサー値（校正前）', unit: '' }
    };
    const AUDIO_BUCKET = cfg.supabaseBucket || 'recordings';
    const AUDIO_OBJECT = cfg.latestAudioPath || 'latest.wav';

    let audioLoading = false;

    // 自動運転の温度しきい値（現段階ではこのブラウザ内だけに保存）
    const TEMP_SETTINGS_KEY = 'indoorMonitorTemperatureSettings';
    const DEFAULT_TEMP_SETTINGS = { upper: 28, lower: 26 };
    let temperatureSettings = loadTemperatureSettings();

    function loadTemperatureSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem(TEMP_SETTINGS_KEY) || 'null');
        if (
          saved &&
          Number.isFinite(Number(saved.upper)) &&
          Number.isFinite(Number(saved.lower)) &&
          Number(saved.upper) >= 15 &&
          Number(saved.upper) <= 40 &&
          Number(saved.lower) >= 15 &&
          Number(saved.lower) <= 40 &&
          Number(saved.upper) > Number(saved.lower)
        ) {
          return { upper: Number(saved.upper), lower: Number(saved.lower) };
        }
      } catch (error) {
        console.warn('温度設定を読み込めませんでした:', error);
      }
      return { ...DEFAULT_TEMP_SETTINGS };
    }

    function saveTemperatureSettings() {
      try {
        localStorage.setItem(TEMP_SETTINGS_KEY, JSON.stringify(temperatureSettings));
        const status = $('temperatureSettingsStatus');
        if (status) status.textContent = 'このブラウザに設定を保存しました（機器への送信は未実装です）。';
      } catch (error) {
        const status = $('temperatureSettingsStatus');
        if (status) status.textContent = '保存できませんでした。ブラウザの保存設定を確認してください。';
      }
    }

    function renderTemperatureSettings() {
      if ($('autoUpperLimit')) $('autoUpperLimit').textContent = String(temperatureSettings.upper);
      if ($('autoLowerLimit')) $('autoLowerLimit').textContent = String(temperatureSettings.lower);
      document.querySelectorAll('[data-temp-target]').forEach(button => {
        const target = button.dataset.tempTarget;
        const delta = Number(button.dataset.tempDelta);
        const next = temperatureSettings[target] + delta;
        button.disabled = next < 15 || next > 40 ||
          (target === 'upper' && next <= temperatureSettings.lower) ||
          (target === 'lower' && next >= temperatureSettings.upper);
      });
    }

    function changeTemperatureSetting(target, delta) {
      const next = temperatureSettings[target] + delta;
      if (!Number.isFinite(next) || next < 15 || next > 40) return;

      if (target === 'upper' && next <= temperatureSettings.lower) {
        const status = $('temperatureSettingsStatus');
        if (status) status.textContent = '上限温度は下限温度より高く設定してください。';
        return;
      }
      if (target === 'lower' && next >= temperatureSettings.upper) {
        const status = $('temperatureSettingsStatus');
        if (status) status.textContent = '下限温度は上限温度より低く設定してください。';
        return;
      }

      temperatureSettings[target] = next;
      renderTemperatureSettings();
      saveTemperatureSettings();
    }

    function setupTemperatureSettings() {
      renderTemperatureSettings();
      document.querySelectorAll('[data-temp-target]').forEach(button => {
        button.addEventListener('click', () => {
          changeTemperatureSetting(
            button.dataset.tempTarget,
            Number(button.dataset.tempDelta)
          );
        });
      });

      const resetButton = $('resetTemperatureSettings');
      if (resetButton) {
        resetButton.addEventListener('click', () => {
          temperatureSettings = { ...DEFAULT_TEMP_SETTINGS };
          renderTemperatureSettings();
          saveTemperatureSettings();
        });
      }

      const status = $('temperatureSettingsStatus');
      if (status) {
        status.textContent = '設定を読み込みました。変更内容はこのブラウザに保存されます。';
      }
    }



    // 追加ダッシュボード機能は現段階ではWebブラウザ内で動作します。
    const DASHBOARD_KEY = 'indoorMonitorDashboardSettings';
    const EVENTS_KEY = 'indoorMonitorRecentEvents';
    let selectedRangeDays = 1;
    let previousSensorState = {};
    let wakeEvents = [];
    let dashboardSettings = loadDashboardSettings();
    let recentEvents = loadEvents();

    function loadDashboardSettings() {
      const defaults = {
        fanMode: 'AUTO', fanOn: false,
        notifyDoor: true, notifyGas: true, notifyCall: true,
        gasThreshold: 400
      };
      try {
        const saved = JSON.parse(localStorage.getItem(DASHBOARD_KEY) || 'null');
        return saved ? { ...defaults, ...saved } : defaults;
      } catch (_) { return defaults; }
    }

    function saveDashboardSettings() {
      try {
        localStorage.setItem(DASHBOARD_KEY, JSON.stringify(dashboardSettings));
      } catch (error) {
        console.warn('ダッシュボード設定を保存できません:', error);
      }
    }

    function loadEvents() {
      try {
        const value = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]');
        return Array.isArray(value) ? value.slice(0, 30) : [];
      } catch (_) { return []; }
    }

    function logEvent(category, message) {
      const item = {
        time: new Date().toISOString(),
        category: String(category || '情報'),
        message: String(message || '')
      };
      recentEvents.unshift(item);
      recentEvents = recentEvents.slice(0, 30);
      try { localStorage.setItem(EVENTS_KEY, JSON.stringify(recentEvents)); } catch (_) {}
      renderEvents();
    }

    function renderEvents() {
      const list = $('recentEvents');
      if (!list) return;
      list.replaceChildren();
      if (!recentEvents.length) {
        const li = document.createElement('li');
        li.textContent = 'まだ出来事はありません。';
        list.appendChild(li);
        return;
      }
      recentEvents.slice(0, 8).forEach(event => {
        const li = document.createElement('li');
        const time = document.createElement('span');
        time.className = 'event-time';
        const d = new Date(event.time);
        time.textContent = Number.isNaN(d.getTime())
          ? '--:--'
          : d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const body = document.createElement('span');
        const tag = document.createElement('span');
        tag.className = 'event-tag';
        tag.textContent = event.category;
        body.append(tag, document.createTextNode(event.message));
        li.append(time, body);
        list.appendChild(li);
      });
    }

    function renderFanControls() {
      document.querySelectorAll('[data-fan-mode]').forEach(button => {
        const active = button.dataset.fanMode === dashboardSettings.fanMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      const badge = $('fanStateBadge');
      if (badge) badge.textContent = dashboardSettings.fanOn ? '運転中（画面内）' : '停止中（画面内）';
      const on = $('fanOnBtn');
      const off = $('fanOffBtn');
      if (on) on.disabled = dashboardSettings.fanMode !== 'MANUAL';
      if (off) off.disabled = dashboardSettings.fanMode !== 'MANUAL';
      const status = $('fanControlStatus');
      if (status) {
        status.textContent = dashboardSettings.fanMode === 'AUTO'
          ? '自動モードです。上限・下限温度を画面内に保存しています。実機への送信は未接続です。'
          : '手動モードです。ON／OFF操作は画面内の状態だけを変更します。実機への送信は未接続です。';
      }
    }

    function setupDashboardFeatures() {
      // サーキュレーター（Web画面内の状態のみ）
      document.querySelectorAll('[data-fan-mode]').forEach(button => {
        button.addEventListener('click', () => {
          dashboardSettings.fanMode = button.dataset.fanMode;
          saveDashboardSettings();
          renderFanControls();
          logEvent('家電', '運転モードを' + (dashboardSettings.fanMode === 'AUTO' ? '自動' : '手動') + 'に変更');
        });
      });
      if ($('fanOnBtn')) $('fanOnBtn').addEventListener('click', () => {
        if (dashboardSettings.fanMode !== 'MANUAL') return;
        dashboardSettings.fanOn = true;
        saveDashboardSettings();
        renderFanControls();
        logEvent('家電', 'サーキュレーター ON（画面内のみ）');
      });
      if ($('fanOffBtn')) $('fanOffBtn').addEventListener('click', () => {
        if (dashboardSettings.fanMode !== 'MANUAL') return;
        dashboardSettings.fanOn = false;
        saveDashboardSettings();
        renderFanControls();
        logEvent('家電', 'サーキュレーター OFF（画面内のみ）');
      });

      // 通知スイッチの保存
      ['notifyDoor', 'notifyGas', 'notifyCall'].forEach(id => {
        const input = $(id);
        if (!input) return;
        input.checked = Boolean(dashboardSettings[id]);
        input.addEventListener('change', () => {
          dashboardSettings[id] = input.checked;
          saveDashboardSettings();
          if ($('notificationStatus')) {
            $('notificationStatus').textContent = '通知設定をこのブラウザに保存しました。';
          }
        });
      });

      if ($('testNotificationBtn')) $('testNotificationBtn').addEventListener('click', async () => {
        const status = $('notificationStatus');
        if (!('Notification' in window)) {
          if (status) status.textContent = 'このブラウザは通知APIに対応していません。';
          return;
        }
        try {
          let permission = Notification.permission;
          if (permission === 'default') permission = await Notification.requestPermission();
          if (permission === 'granted') {
            new Notification('室内監視システム', { body: 'テスト通知です。' });
            if (status) status.textContent = 'テスト通知を表示しました。ブラウザの通知許可が有効です。';
            logEvent('通知', 'テスト通知を実行');
          } else if (status) {
            status.textContent = '通知は許可されていません。ブラウザのサイト設定を確認してください。';
          }
        } catch (error) {
          if (status) status.textContent = '通知を表示できませんでした: ' + error.message;
        }
      });

      // 呼び出し確認・録音再生
      if ($('ackCallAlert')) $('ackCallAlert').addEventListener('click', () => {
        const card = $('callAlert');
        if (card) card.classList.add('acknowledged');
        if ($('callAlertTitle')) $('callAlertTitle').textContent = '呼び出しを確認済みにしました';
        if ($('callAlertDetail')) $('callAlertDetail').textContent = 'この確認状態は現在の画面に表示しています。';
        logEvent('呼び出し', '呼び出しを確認済みにした');
      });
      if ($('playCallAudio')) $('playCallAudio').addEventListener('click', async () => {
        const player = $('latestAudio');
        if (!player || !player.src) {
          if ($('audioStatus')) $('audioStatus').textContent = '先に最新の録音を取得してください。';
          return;
        }
        try { await player.play(); }
        catch (error) {
          if ($('audioStatus')) $('audioStatus').textContent = '再生できませんでした。再生ボタンを押してください。';
        }
      });

      if ($('clearEventsBtn')) $('clearEventsBtn').addEventListener('click', () => {
        recentEvents = [];
        try { localStorage.removeItem(EVENTS_KEY); } catch (_) {}
        renderEvents();
      });

      // グラフ期間切替
      document.querySelectorAll('[data-range]').forEach(button => {
        button.addEventListener('click', () => {
          selectedRangeDays = Number(button.dataset.range) || 1;
          document.querySelectorAll('[data-range]').forEach(item => {
            const active = item === button;
            item.classList.toggle('active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          drawChart();
        });
      });

      renderFanControls();
      renderEvents();
      renderWakeHistory();
    }

    function renderWakeHistory() {
      const current = $('wakeCurrentStatus');
      const summary = $('wakeSummary');
      const list = $('wakeHistory');
      if (current) {
        const bedText = $('bed')?.textContent || '--';
        current.textContent = bedText === '在床あり' ? '在床あり' :
          bedText === '在床なし' ? '離床中' : '在床状態を確認できません';
      }
      if (summary) summary.textContent = 'センサーの最新状態：' + (($('updatedAt')?.textContent || '').replace('最終更新：', '') || '--');
      if (!list) return;
      list.replaceChildren();
      if (!wakeEvents.length) {
        const li = document.createElement('li');
        li.textContent = 'ページを開いてからの在床状態の変化がここに表示されます。';
        list.appendChild(li);
        return;
      }
      wakeEvents.slice(0, 5).forEach(event => {
        const li = document.createElement('li');
        const time = document.createElement('span');
        time.className = 'event-time';
        time.textContent = event.time;
        const body = document.createElement('span');
        body.textContent = event.message;
        li.append(time, body);
        list.appendChild(li);
      });
    }

    function trackSensorEvents(feed) {
      if (!feed) return;
      const current = {
        door: Number(feed.field4) >= 1,
        bed: Number(feed.field5) >= 1,
        gas: Number(feed.field3)
      };
      if (previousSensorState.door !== undefined && current.door !== previousSensorState.door) {
        const message = current.door ? 'ドアが開きました' : 'ドアが閉まりました';
        logEvent('ドア', message);
        if (dashboardSettings.notifyDoor) showBrowserNotification('ドア状態', message);
      }
      if (previousSensorState.bed !== undefined && current.bed !== previousSensorState.bed) {
        const message = current.bed ? '在床を検知しました' : '離床を検知しました';
        wakeEvents.unshift({
          time: new Date().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}),
          message
        });
        wakeEvents = wakeEvents.slice(0, 10);
        renderWakeHistory();
        logEvent('ベッド', message);
      }
      if (Number.isFinite(current.gas) && previousSensorState.gas !== undefined &&
          current.gas >= dashboardSettings.gasThreshold && previousSensorState.gas < dashboardSettings.gasThreshold) {
        logEvent('ガス', '設定しきい値を超えました（校正前の値）');
        if (dashboardSettings.notifyGas) showBrowserNotification('ガスセンサー', 'しきい値を超えました。現地を確認してください。');
      }
      previousSensorState = current;
      renderWakeHistory();
    }

    function showBrowserNotification(title, body) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try { new Notification(title, { body }); } catch (_) {}
    }

    function formatAudioDate(value) {
      if (!value) return '';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP');
    }

    // 録音一覧APIを使わず、固定ファイル latest.wav の署名付きURLを直接取得する
    async function refreshLatestAudio() {
      if (audioLoading) return;

      const status = $('audioStatus');
      const fileName = $('audioFileName');
      const player = $('latestAudio');
      if (!status || !fileName || !player) return;

      if (
        !cfg.supabaseUrl ||
        !cfg.supabaseAnonKey ||
        String(cfg.supabaseUrl).includes('YOUR_') ||
        String(cfg.supabaseAnonKey).includes('YOUR_')
      ) {
        fileName.textContent = 'Supabaseの設定が必要です';
        status.textContent = 'config.js にSupabase URLと公開可能キーを設定してください。';
        player.hidden = true;
        return;
      }

      audioLoading = true;
      status.textContent = '最新の録音を確認しています…';

      try {
        const base = String(cfg.supabaseUrl).replace(/\/+$/, '');
        const headers = {
          apikey: cfg.supabaseAnonKey,
          Authorization: `Bearer ${cfg.supabaseAnonKey}`,
          'Content-Type': 'application/json'
        };

        const encodedPath = AUDIO_OBJECT
          .split('/')
          .map(encodeURIComponent)
          .join('/');
        const signUrl =
          `${base}/storage/v1/object/sign/` +
          `${encodeURIComponent(AUDIO_BUCKET)}/${encodedPath}`;

        const signRes = await fetch(signUrl, {
          method: 'POST',
          headers,
          cache: 'no-store',
          body: JSON.stringify({ expiresIn: 3600 })
        });

        if (!signRes.ok) {
          const detail = await signRes.text();
          console.error('Supabase署名付きURL取得エラー', {
            url: signUrl,
            status: signRes.status,
            response: detail
          });

          if (signRes.status === 404) {
            throw new Error(
              `録音ファイルが見つかりません (HTTP 404)。` +
              `${AUDIO_BUCKET}/${AUDIO_OBJECT} が存在するか確認してください。` +
              ` 詳細: ${detail.slice(0, 250)}`
            );
          }
          if (signRes.status === 400 || signRes.status === 403) {
            throw new Error(
              `録音へのアクセスに失敗しました (HTTP ${signRes.status})。` +
              `StorageのSELECTポリシー、バケット名、ファイル名を確認してください。` +
              ` 詳細: ${detail.slice(0, 250)}`
            );
          }
          throw new Error(
            `再生URLを取得できません (HTTP ${signRes.status})。` +
            detail.slice(0, 250)
          );
        }

        const signed = await signRes.json();
        const signedPath = signed.signedURL || signed.signedUrl;
        if (!signedPath) {
          throw new Error('Supabaseから署名付き再生URLが返されませんでした。');
        }

        let audioUrl;
        if (/^https?:\/\//i.test(signedPath)) {
          audioUrl = signedPath;
        } else if (signedPath.startsWith('/storage/v1/')) {
          audioUrl = `${base}${signedPath}`;
        } else {
          audioUrl = `${base}/storage/v1/${signedPath.replace(/^\/+/, '')}`;
        }

        // URLの署名は毎回変わる場合があるため、一定時間経過後に更新する
        
        player.src = audioUrl;
        player.dataset.signedAt = String(Date.now());
        player.load();


        fileName.textContent = '最新の録音';
        status.textContent = `${AUDIO_OBJECT} ・ 再生URLを取得しました`;
        player.hidden = false;
      } catch (e) {
        console.error('Supabase録音取得エラー:', e);
        fileName.textContent = '録音を取得できません';
        status.textContent = e.message || 'Supabaseの設定と通信を確認してください。';
        player.pause();
        player.removeAttribute('src');
        player.load();
        player.hidden = true;
      } finally {
        audioLoading = false;
      }
    }

    let selectedField = '1';
    let latestFeed = null;
    let feeds = [];
    let loading = false;

    const validConfig = () =>
      cfg.channelId &&
      cfg.readApiKey &&
      !String(cfg.channelId).includes('YOUR_') &&
      !String(cfg.readApiKey).includes('YOUR_');

    function setConnection(ok, text) {
      const dot = $('connectionDot');
      const label = $('connectionText');
      if (dot) dot.className = 'dot ' + (ok ? 'ok' : 'bad');
      if (label) label.textContent = text;
    }

    function setAlert(kind, title, detail, icon) {
      const el = $('alertCard');
      if (!el) return;
      el.className = 'alert-card' + (kind ? ' ' + kind : '');
      if ($('alertTitle')) $('alertTitle').textContent = title;
      if ($('alertDetail')) $('alertDetail').textContent = detail;
      if ($('alertIcon')) $('alertIcon').textContent = icon;
    }

    function fmtNum(v, digits = 1) {
      if (v === null || v === undefined || v === '') return '--';
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(digits) : '--';
    }

    function statusText(v, yes, no) {
      if (v === null || v === undefined || v === '') return '--';
      return Number(v) >= 1 ? yes : no;
    }

    function renderLatest(f) {
      if (!f) return;
      if ($('temperature')) $('temperature').textContent = fmtNum(f.field1);
      if ($('humidity')) $('humidity').textContent = fmtNum(f.field2);
      if ($('gas')) $('gas').textContent = fmtNum(f.field3, 0);
      if ($('door')) $('door').textContent = statusText(f.field4, '開いています', '閉まっています');
      if ($('bed')) $('bed').textContent = statusText(f.field5, '在床あり', '在床なし');

      if (f.created_at) {
        const d = new Date(f.created_at);
        if ($('updatedAt')) {
          $('updatedAt').textContent =
            '最終更新：' +
            (Number.isNaN(d.getTime()) ? f.created_at : d.toLocaleString('ja-JP'));
        }

        const age = Date.now() - d.getTime();
        if (Number.isFinite(age) && age > 5 * 60 * 1000) {
          setAlert(
            'warning',
            'データの更新が遅れています',
            '最後の記録から5分以上経過しています。Raspberry Piとネットワークを確認してください。',
            '!'
          );
        } else {
          setAlert(
            '',
            '監視データを受信しています',
            '以下はクラウドに保存された最新の測定値です。',
            '✓'
          );
        }
      }

      if (f.field1 !== '' && Number(f.field1) >= 30) {
        setAlert(
          'warning',
          '室温が高くなっています',
          '室温が30℃以上です。現地の状況を確認してください。',
          '!'
        );
      }
    }

    async function api(path) {
      const url =
        `https://api.thingspeak.com/channels/${encodeURIComponent(cfg.channelId)}/${path}` +
        `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(cfg.readApiKey)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('クラウドAPIエラー: HTTP ' + res.status);
      return res.json();
    }

    async function refresh() {
      if (loading) return;

      if (!validConfig()) {
        setConnection(false, '初期設定が必要です');
        setAlert(
          'warning',
          'クラウド設定が未完了です',
          'config.js にチャンネルIDと読み取りAPIキーを設定してください。',
          '!'
        );
        if ($('chartEmpty')) {
          $('chartEmpty').textContent = 'config.js の設定後に履歴が表示されます。';
        }
        return;
      }

      loading = true;
      try {
        const [last, history] = await Promise.all([
          api('feeds/last.json'),
          api(`feeds.json?results=${Math.min(8000, Math.max(1, Number(cfg.historyResults) || 100))}`)
        ]);

        if (last && last.created_at) {
          latestFeed = last;
          renderLatest(last);
          trackSensorEvents(last);
        }
        feeds = Array.isArray(history.feeds) ? history.feeds : [];

        if (!latestFeed && feeds.length) {
          latestFeed = feeds[feeds.length - 1];
          renderLatest(latestFeed);
          trackSensorEvents(latestFeed);
        }
        if (!latestFeed) {
          throw new Error('データがまだありません。Piから最初のデータを送信してください。');
        }

        setConnection(true, 'クラウド接続中');
        drawChart();
      } catch (e) {
        setConnection(false, '接続できません');
        if (!latestFeed) {
          setAlert(
            'error',
            'データを取得できません',
            e.message + ' チャンネルID・Read API Key・インターネット接続を確認してください。',
            '×'
          );
        }
        if ($('chartEmpty')) {
          $('chartEmpty').textContent = 'データを取得できません。設定と通信を確認してください。';
        }
      } finally {
        loading = false;
      }
    }

    function drawChart() {
      const canvas = $('historyChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const cutoff = Date.now() - selectedRangeDays * 24 * 60 * 60 * 1000;
      const data = feeds
        .filter(f =>
          f['field' + selectedField] !== null &&
          f['field' + selectedField] !== '' &&
          Number.isFinite(Number(f['field' + selectedField])) &&
          f.created_at && new Date(f.created_at).getTime() >= cutoff
        )
        .slice(-500);

      const meta = labels[selectedField];
      if ($('chartTitle')) $('chartTitle').textContent = meta.title;
      if ($('legendText')) $('legendText').textContent = meta.legend;
      if ($('chartRange')) $('chartRange').textContent = data.length ? `${selectedRangeDays === 1 ? '24時間' : selectedRangeDays + '日'}・${data.length}件` : '記録なし';
      if ($('chartEmpty')) $('chartEmpty').style.display = data.length ? 'none' : 'grid';
      if (!data.length) return;

      const pad = { l: 42, r: 12, t: 14, b: 34 };
      const cw = w - pad.l - pad.r;
      const ch = h - pad.t - pad.b;
      const vals = data.map(f => Number(f['field' + selectedField]));
      let min = Math.min(...vals);
      let max = Math.max(...vals);
      if (min === max) {
        min -= 1;
        max += 1;
      }
      const margin = (max - min) * 0.12;
      min -= margin;
      max += margin;

      ctx.font = '10px system-ui, sans-serif';
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#e5ebf0';
      ctx.fillStyle = '#738391';

      for (let i = 0; i < 5; i++) {
        const y = pad.t + ch * i / 4;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();

        const v = max - (max - min) * i / 4;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(v.toFixed(selectedField === '3' ? 0 : 1), pad.l - 7, y);
      }

      const pts = data.map((f, i) => ({
        x: pad.l + (data.length === 1 ? cw / 2 : cw * i / (data.length - 1)),
        y: pad.t + ch * (max - Number(f['field' + selectedField])) / (max - min),
        t: new Date(f.created_at)
      }));

      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = '#2276a8';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      if (pts.length < 60) {
        pts.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#2276a8';
          ctx.fill();
        });
      }

      ctx.fillStyle = '#738391';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(
        pts[0].t.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        pad.l,
        h - pad.b + 12
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        pts[pts.length - 1].t.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        w - pad.r,
        h - pad.b + 12
      );
    }

    document.querySelectorAll('.tab').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        selectedField = b.dataset.field;
        drawChart();
      });
    });

    if ($('refreshBtn')) $('refreshBtn').addEventListener('click', refresh);
    if ($('historyRefresh')) $('historyRefresh').addEventListener('click', refresh);
    if ($('audioRefresh')) $('audioRefresh').addEventListener('click', refreshLatestAudio);
    window.addEventListener('resize', drawChart);

    // 古いService Workerを解除し、キャッシュによる不具合を防ぐ
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => {
          return Promise.all(
            registrations.map(registration => registration.unregister())
          );
        })
        .catch(error => {
          console.warn('Service Workerの解除に失敗しました:', error);
        });
    }

    setupTemperatureSettings();
    setupDashboardFeatures();

    refresh();
    refreshLatestAudio();

    setInterval(refresh, Math.max(30000, Number(cfg.refreshMs) || 30000));
    setInterval(refreshLatestAudio, Math.max(60000, Number(cfg.audioRefreshMs) || 60000));
  }

  if (sessionStorage.getItem('indoorMonitorLoggedIn') === '1') {
    showApp();
  } else {
    showLogin();
  }
})();
