import { Notti } from '/sdk/index.js';

const $ = (id) => document.getElementById(id);
const fields = ['host', 'appId', 'clientKey', 'userId'];

// Remember the form between reloads. Storage can be blocked, so it is optional.
for (const id of fields) {
  try {
    const saved = localStorage.getItem(`notti-sample:${id}`);
    if (saved) $(id).value = saved;
  } catch {
    // Not available; the form just starts empty.
  }
}

let last = { init: null, enable: null };

async function render() {
  const device = await Notti.getSubscription();
  $('state').textContent = JSON.stringify(
    {
      init: last.init,
      permission:
        'Notification' in window ? Notification.permission : 'unsupported',
      enable: last.enable,
      device,
    },
    null,
    2
  );
}

$('init').addEventListener('click', async () => {
  for (const id of fields) {
    try {
      localStorage.setItem(`notti-sample:${id}`, $(id).value);
    } catch {
      // Ignore.
    }
  }
  last.init = await Notti.init({
    appId: $('appId').value.trim(),
    clientKey: $('clientKey').value.trim(),
    host: $('host').value.trim(),
    serviceWorkerPath: '/notti-sw.js',
  });
  await render();
});

// requestPermission must run inside a user gesture, so it is called straight
// from the click handler.
$('enable').addEventListener('click', async () => {
  last.enable = await Notti.requestPermission();
  await render();
});

$('identify').addEventListener('click', async () => {
  await Notti.identify($('userId').value);
  await render();
});

$('tag').addEventListener('click', async () => {
  await Notti.setTags({ plan: 'pro' });
  await render();
});

$('logout').addEventListener('click', async () => {
  await Notti.logout();
  await render();
});

$('refresh').addEventListener('click', render);

render();
