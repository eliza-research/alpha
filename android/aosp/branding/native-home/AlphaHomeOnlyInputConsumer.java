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

import static com.android.quickstep.OverviewComponentObserver.startHomeIntentSafely;

import android.content.Context;
import android.graphics.PointF;
import android.view.MotionEvent;

import com.android.quickstep.GestureState;
import com.android.quickstep.InputConsumer;
import com.android.quickstep.RecentsAnimationDeviceState;
import com.android.quickstep.TopTaskTracker.CachedTaskInfo;
import com.android.quickstep.util.NavBarPosition;
import com.android.quickstep.util.TriggerSwipeUpTouchTracker;
import com.android.systemui.shared.system.InputMonitorCompat;

import java.util.function.Predicate;
import java.util.function.Supplier;

/** A native atomic Home gesture: no task surface is animated while the finger moves. */
public final class AlphaHomeOnlyInputConsumer implements InputConsumer,
        TriggerSwipeUpTouchTracker.OnSwipeUpListener {
    private static final String TAG = "AlphaHomeOnlyInputConsumer";
    private final Context mContext;
    private final GestureState mGestureState;
    private final InputMonitorCompat mInputMonitor;
    private final NavBarPosition mNavBarPosition;
    private final TriggerSwipeUpTouchTracker mTracker;
    private final Supplier<CachedTaskInfo> mCurrentTask;
    private final Predicate<CachedTaskInfo> mHomeAllowed;
    private CachedTaskInfo mEventTask;
    private float mDownX;
    private float mDownY;
    private float mInwardDisplacement;
    private boolean mFinished;
    private boolean mTracking;

    public AlphaHomeOnlyInputConsumer(Context context, RecentsAnimationDeviceState deviceState,
            GestureState gestureState, InputMonitorCompat inputMonitor,
            Supplier<CachedTaskInfo> currentTask, Predicate<CachedTaskInfo> homeAllowed) {
        mContext = context;
        mGestureState = gestureState;
        mInputMonitor = inputMonitor;
        mCurrentTask = currentTask;
        mHomeAllowed = homeAllowed;
        mNavBarPosition = deviceState.getNavBarPosition();
        mTracker = new TriggerSwipeUpTouchTracker(context, true, mNavBarPosition, this);
    }

    @Override public int getType() { return TYPE_ALPHA_HOME_ONLY; }
    @Override public int getDisplayId() { return mGestureState.getDisplayId(); }
    @Override public boolean allowInterceptByParent() { return !mTracker.interceptedTouch(); }

    @Override
    public void onMotionEvent(MotionEvent event) {
        if (mFinished) return;
        // Read the platform's current task view for each event, not gesture creation state.
        // The UP event's snapshot is shared by its admission and Home/no-op decision.
        mEventTask = mCurrentTask.get();
        if (mEventTask == null || !mHomeAllowed.test(mEventTask)) {
            finish();
            return;
        }
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            mDownX = event.getX();
            mDownY = event.getY();
            mInwardDisplacement = 0;
            mTracking = true;
        } else if (!mTracking) {
            return;
        }
        float dx = event.getX() - mDownX;
        float dy = event.getY() - mDownY;
        mInwardDisplacement = mNavBarPosition.isRightEdge() ? -dx
                : mNavBarPosition.isLeftEdge() ? dx : -dy;
        // Reject outward pulls before the shared tracker's unsigned slow-swipe check.
        if ((action == MotionEvent.ACTION_MOVE || action == MotionEvent.ACTION_UP)
                && mInwardDisplacement < 0) {
            finish();
            return;
        }
        mTracker.onMotionEvent(event);
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) finish();
    }

    @Override
    public void onSwipeUpTouchIntercepted() {
        if (!mFinished && mInwardDisplacement > 0 && mEventTask != null && mHomeAllowed.test(mEventTask)
                && mInputMonitor != null) {
            mInputMonitor.pilferPointers();
        }
    }

    @Override
    public void onSwipeUp(boolean wasFling, PointF finalVelocity) {
        if (!mFinished && mInwardDisplacement > 0 && mEventTask != null && mHomeAllowed.test(mEventTask)) {
            // Claim completion before launching; no second callback may launch another Home.
            mFinished = true;
            // Alpha handles HOME inside its activity even when it already owns the top task.
            startHomeIntentSafely(mContext, mGestureState.getHomeIntent(), null, TAG);
        }
    }

    @Override public void onSwipeUpCancelled() { finish(); }
    @Override public void onConsumerAboutToBeSwitched() { finish(); }

    private void finish() {
        mFinished = true;
        mTracking = false;
        mTracker.endTouchTracking();
    }
}
