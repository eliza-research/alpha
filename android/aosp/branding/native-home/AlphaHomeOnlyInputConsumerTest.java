/*
 * Copyright (C) 2026 The Android Open Source Project
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed
 * under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied.
 */
package com.android.quickstep.inputconsumers;

import static com.google.common.truth.Truth.assertThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.Surface;

import androidx.test.annotation.UiThreadTest;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SmallTest;
import androidx.test.platform.app.InstrumentationRegistry;

import com.android.launcher3.util.NavigationMode;
import com.android.quickstep.GestureState;
import com.android.quickstep.InputConsumer;
import com.android.quickstep.RecentsAnimationDeviceState;
import com.android.quickstep.TopTaskTracker.CachedTaskInfo;
import com.android.quickstep.util.NavBarPosition;
import com.android.systemui.shared.system.InputMonitorCompat;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises native MotionEvents and the real swipe tracker without launching an activity. */
@SmallTest
@UiThreadTest
@RunWith(AndroidJUnit4.class)
public class AlphaHomeOnlyInputConsumerTest {
    private final CachedTaskInfo mApp = mock(CachedTaskInfo.class);
    private final CachedTaskInfo mHome = mock(CachedTaskInfo.class);
    private final CachedTaskInfo mBlocked = mock(CachedTaskInfo.class);
    private final InputMonitorCompat mMonitor = mock(InputMonitorCompat.class);
    private final GestureState mGestureState = mock(GestureState.class);
    private CachedTaskInfo mCurrent;
    private RecordingContext mContext;
    private AlphaHomeOnlyInputConsumer mConsumer;
    private boolean mAllowed;
    private int mSnapshots;
    private long mDownTime;
    private long mEventTime;

    @Before
    public void setUp() {
        mContext = new RecordingContext(
                InstrumentationRegistry.getInstrumentation().getTargetContext());
        when(mHome.isHomeTask()).thenReturn(true);
        when(mGestureState.getHomeIntent()).thenReturn(new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        when(mGestureState.getDisplayId()).thenReturn(0);
        RecentsAnimationDeviceState deviceState = mock(RecentsAnimationDeviceState.class);
        when(deviceState.getNavBarPosition()).thenReturn(
                new NavBarPosition(false, Surface.ROTATION_0, NavigationMode.NO_BUTTON));
        mCurrent = mApp;
        mAllowed = true;
        mDownTime = mEventTime = SystemClock.uptimeMillis();
        mConsumer = new AlphaHomeOnlyInputConsumer(mContext, deviceState, mGestureState,
                mMonitor, () -> {
                    mSnapshots++;
                    return mCurrent;
                }, task -> mAllowed && task != mBlocked);
    }

    @After
    public void tearDown() {
        mConsumer.onConsumerAboutToBeSwitched();
    }

    @Test
    public void upwardCompletionLaunchesHomeOnlyOnce() {
        swipe(1000);
        assertThat(mContext.launches).isEqualTo(1);
        assertThat(mSnapshots).isEqualTo(3);
        assertThat(mConsumer.getType()).isEqualTo(InputConsumer.TYPE_ALPHA_HOME_ONLY);
        verify(mMonitor, atLeastOnce()).pilferPointers();
        event(MotionEvent.ACTION_UP, 100, 100, 100);
        assertThat(mContext.launches).isEqualTo(1);
        assertThat(mSnapshots).isEqualTo(3);
    }

    @Test
    public void fastUpwardCompletionAlsoLaunchesHome() {
        swipe(10);
        assertThat(mContext.launches).isEqualTo(1);
    }

    @Test
    public void homeAtCompletionDeliversHomeOnlyOnce() {
        mCurrent = mHome;
        swipe(1000);
        assertThat(mContext.launches).isEqualTo(1);
        event(MotionEvent.ACTION_UP, 100, 100, 1100);
        assertThat(mContext.launches).isEqualTo(1);
    }

    @Test
    public void homeToAppUsesCompletionTask() {
        mCurrent = mHome;
        downAndMove();
        mCurrent = mApp;
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(1);
    }

    @Test
    public void appToHomeUsesCompletionTask() {
        downAndMove();
        mCurrent = mHome;
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(1);
    }

    @Test
    public void taskBecomingBlockedCancelsCompletion() {
        downAndMove();
        mCurrent = mBlocked;
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    @Test
    public void taskDisappearingCancelsCompletion() {
        downAndMove();
        mCurrent = null;
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    @Test
    public void admissionRevokedDuringGestureCancelsPermanently() {
        downAndMove();
        mAllowed = false;
        event(MotionEvent.ACTION_MOVE, 100, 100, 1000);
        mAllowed = true;
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    @Test
    public void outwardMotionDoesNotLaunchHome() {
        event(MotionEvent.ACTION_DOWN, 100, 100, 1);
        event(MotionEvent.ACTION_MOVE, 100, 1000, 1000);
        event(MotionEvent.ACTION_UP, 100, 1000, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    @Test
    public void horizontalMotionDoesNotLaunchHome() {
        event(MotionEvent.ACTION_DOWN, 100, 100, 1);
        event(MotionEvent.ACTION_MOVE, 1000, 100, 1000);
        event(MotionEvent.ACTION_UP, 1000, 100, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    @Test
    public void cancelDoesNotLaunchHome() {
        downAndMove();
        event(MotionEvent.ACTION_CANCEL, 100, 100, 1000);
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    @Test
    public void consumerSwitchDoesNotLaunchHome() {
        downAndMove();
        mConsumer.onConsumerAboutToBeSwitched();
        event(MotionEvent.ACTION_UP, 100, 100, 1000);
        assertThat(mContext.launches).isEqualTo(0);
    }

    private void swipe(long interval) {
        event(MotionEvent.ACTION_DOWN, 100, 1000, 1);
        event(MotionEvent.ACTION_MOVE, 100, 100, interval);
        event(MotionEvent.ACTION_UP, 100, 100, interval);
    }

    private void downAndMove() {
        event(MotionEvent.ACTION_DOWN, 100, 1000, 1);
        event(MotionEvent.ACTION_MOVE, 100, 100, 1000);
    }

    private void event(int action, float x, float y, long elapsed) {
        mEventTime += elapsed;
        MotionEvent event = MotionEvent.obtain(mDownTime, mEventTime, action, x, y, 0);
        try {
            mConsumer.onMotionEvent(event);
        } finally {
            event.recycle();
        }
    }

    private static final class RecordingContext extends ContextWrapper {
        int launches;

        RecordingContext(Context context) {
            super(context);
        }

        @Override
        public void startActivity(Intent intent, Bundle options) {
            assertThat(intent.hasCategory(Intent.CATEGORY_HOME)).isTrue();
            launches++;
        }
    }
}
