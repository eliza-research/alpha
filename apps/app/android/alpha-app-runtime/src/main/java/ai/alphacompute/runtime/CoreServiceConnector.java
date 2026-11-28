package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.IInterface;
import android.os.Looper;
import android.os.RemoteException;
import java.io.Closeable;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/** Signature-verified Binder service connector for binding from thin Alpha apps to {@code AlphaCore}. */
public final class CoreServiceConnector<T extends IInterface> implements Closeable {
    private static final long DEFAULT_CONNECT_TIMEOUT_MS = 5_000L;

    private final Context context;
    private final String action;
    private final Function<IBinder, T> converter;
    private final Object lock = new Object();

    private T service;
    private IBinder rawBinder;
    private boolean bound;
    private boolean closed;
    private CountDownLatch pending;

    private final IBinder.DeathRecipient deathRecipient = () -> {
        synchronized (lock) {
            service = null;
            rawBinder = null;
        }
    };

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            T proxy = converter.apply(binder);
            synchronized (lock) {
                if (closed) {
                    unbindQuietly();
                    return;
                }
                rawBinder = binder;
                service = proxy;
                try {
                    binder.linkToDeath(deathRecipient, 0);
                } catch (RemoteException dead) {
                    service = null;
                    rawBinder = null;
                }
                if (pending != null) {
                    pending.countDown();
                    pending = null;
                }
            }
        }

        @Override public void onServiceDisconnected(ComponentName name) {
            synchronized (lock) {
                clearProxyLocked();
            }
        }

        @Override public void onBindingDied(ComponentName name) {
            synchronized (lock) {
                clearProxyLocked();
                unbindQuietly();
            }
        }

        @Override public void onNullBinding(ComponentName name) {
            synchronized (lock) {
                clearProxyLocked();
                if (pending != null) {
                    pending.countDown();
                    pending = null;
                }
            }
        }
    };

    public CoreServiceConnector(Context context, String action, Function<IBinder, T> converter) {
        this.context = Objects.requireNonNull(context, "context").getApplicationContext();
        this.action = Objects.requireNonNull(action, "action");
        this.converter = Objects.requireNonNull(converter, "converter");
    }

    /** Returns an active verified Binder proxy, binding to {@code AlphaCore} if necessary. */
    public T connect() {
        return connect(DEFAULT_CONNECT_TIMEOUT_MS);
    }

    /** Returns an active verified Binder proxy within {@code timeoutMs}, or {@code null} when unavailable. */
    public T connect(long timeoutMs) {
        if (!AlphaIpcContract.hasSameSignatureAsCore(context)) {
            return null;
        }
        CountDownLatch latch;
        synchronized (lock) {
            if (closed) return null;
            if (service != null && rawBinder != null && rawBinder.isBinderAlive()) {
                return service;
            }
            clearProxyLocked();
            if (pending == null) {
                pending = new CountDownLatch(1);
                Intent intent = new Intent(action).setPackage(AlphaIpcContract.CORE_PACKAGE);
                boolean started;
                try {
                    started = context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
                } catch (SecurityException | IllegalArgumentException refused) {
                    started = false;
                }
                if (!started) {
                    pending.countDown();
                    pending = null;
                    return null;
                }
                bound = true;
            }
            latch = pending;
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            synchronized (lock) {
                return service;
            }
        }
        try {
            latch.await(Math.max(100L, timeoutMs), TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return null;
        }
        synchronized (lock) {
            return service != null && rawBinder != null && rawBinder.isBinderAlive() ? service : null;
        }
    }

    /** Proactively triggers asynchronous binding without blocking the calling thread. */
    public void warmUp() {
        if (!AlphaIpcContract.hasSameSignatureAsCore(context)) return;
        synchronized (lock) {
            if (closed || bound) return;
            pending = new CountDownLatch(1);
            Intent intent = new Intent(action).setPackage(AlphaIpcContract.CORE_PACKAGE);
            try {
                bound = context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
                if (!bound) {
                    pending.countDown();
                    pending = null;
                }
            } catch (SecurityException | IllegalArgumentException refused) {
                bound = false;
                pending.countDown();
                pending = null;
            }
        }
    }

    @Override public void close() {
        synchronized (lock) {
            closed = true;
            clearProxyLocked();
            if (pending != null) {
                pending.countDown();
                pending = null;
            }
            unbindQuietly();
        }
    }

    private void clearProxyLocked() {
        if (rawBinder != null) {
            try {
                rawBinder.unlinkToDeath(deathRecipient, 0);
            } catch (RuntimeException ignored) {
            }
        }
        rawBinder = null;
        service = null;
    }

    private void unbindQuietly() {
        if (!bound) return;
        bound = false;
        try {
            context.unbindService(connection);
        } catch (IllegalArgumentException ignored) {
        }
    }
}
