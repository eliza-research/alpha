function installPreviewPort() {
  const shell = window.quintMountedCalendar, module = shell.mod('camera');
  const port = window.quintCameraLeave = {requests: [], pending: [], retired: null, microtask: null};
  navigator.mediaDevices.getUserMedia = constraints => {
    if (constraints.audio !== false) throw Error('The closed fixture forbids microphone requests');
    const camera = window.quintMountedCamera();
    const request = {id: port.requests.length + 1, view: shell.S().view, phase: camera.phase, token: camera.token};
    port.requests.push(request);
    return new Promise(resolve => {request.resolve = resolve;port.pending.push(request);});
  };
  port.release = id => {
    const index = port.pending.findIndex(request => request.id === id);
    if (index < 0) throw Error('The selected synthetic stream is not pending');
    const [request] = port.pending.splice(index, 1);
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    let frame = 0;
    const paint = () => {
      context.fillStyle = frame++ % 2 ? '#4675a8' : '#67a873';
      context.fillRect(0, 0, 320, 240);
    };
    paint();
    const stream = request.stream = canvas.captureStream(10);
    const timer = setInterval(() => {
      if (stream.getVideoTracks().every(track => track.readyState === 'ended')) clearInterval(timer);
      else paint();
    }, 80);
    request.resolve(stream);
  };
  port.snapshot = () => {
    const camera = window.quintMountedCamera();
    const video = document.querySelector('[data-alpha-camera="viewfinder"] video');
    const current = ['starting', 'ready'].includes(camera.phase) ?
      port.requests.find(request => request.token === camera.token)?.id ?? 0 : 0;
    const preview = video?.srcObject ? port.requests.find(request => request.stream === video.srcObject)?.id ?? 0 : 0;
    const requests = port.requests.map(({id, view, phase, stream}) => ({id, view, phase,
      status: !stream ? 'pending' : stream.getVideoTracks().every(track => track.readyState === 'ended') ? 'ended' : 'live'}));
    return {view: shell.S().view || 'home', phase: camera.phase, released: camera.released, current, preview, requests};
  };
  const leave = module.onLeave;
  module.onLeave = function (...args) {
    const result = leave.apply(this, args);
    port.retired = port.snapshot();
    return result;
  };
}

export async function mountCameraPreviewPort(f) {
  const {page} = f;
  await page.evaluate(installPreviewPort);
  return {
    async open(id) {
      await f.button('Camera').click();
      await page.waitForFunction(id => window.quintCameraLeave.pending.some(request => request.id === id), id);
    },
    release(id) {
      return page.evaluate(id => window.quintCameraLeave.release(id), id);
    },
    releaseAll() {
      return page.evaluate(() => {
        const port = window.quintCameraLeave;
        while (port.pending.length) port.release(port.pending[0].id);
      });
    },
    ready(id) {
      return page.waitForFunction(id => {
        const video = document.querySelector('[data-alpha-camera="viewfinder"] video');
        const camera = window.quintMountedCamera();
        const request = window.quintCameraLeave.requests.find(request => request.id === id);
        return camera.phase === 'ready' && request?.stream && video?.srcObject === request.stream && video.readyState >= 2;
      }, id);
    },
    ended(ids) {
      return page.waitForFunction(ids => ids.every(id =>
        window.quintCameraLeave.snapshot().requests.find(request => request.id === id)?.status === 'ended'), ids);
    },
    async leave() {
      await page.evaluate(() => {
        const port = window.quintCameraLeave;
        window.dispatchEvent(new Event('launcher-home'));
        queueMicrotask(() => {port.microtask = port.snapshot();});
      });
      await page.waitForFunction(() => window.quintMountedCalendar.S().view !== 'camera' &&
        window.quintMountedCamera().phase === 'off');
    },
    snapshot: () => page.evaluate(() => window.quintCameraLeave.snapshot()),
    retirement: () => page.evaluate(() => ({retired: window.quintCameraLeave.retired, microtask: window.quintCameraLeave.microtask})),
  };
}
