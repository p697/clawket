package com.clawket.qaviewport

import android.content.pm.ApplicationInfo
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.fabric.FabricUIManager
import com.facebook.react.modules.systeminfo.ReactNativeVersion
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewHelper
import com.facebook.react.views.scroll.ScrollEventType
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

private const val LIMIT = 64
private const val MAX = 100_000_000
private const val LIFETIME_MS = 1_200_000L

/** No view mutation, events sent to JS, timers, file I/O or automatic rebind. */
@OptIn(UnstableReactNativeAPI::class)
class ClawketQaViewportModule : Module() {
  private var binding: Binding? = null
  // A ReactHost/module replacement cannot create a second arm in the same process.
  private companion object { var processUsed = false }
  private var generation = 0
  private var status = "idle"
  private var reason: String? = null
  private var started = 0L
  private var ended = 0L
  private var sequence = 0
  private var dropped = 0
  private var rejected = 0
  private var density: Float? = null
  private val events = ArrayDeque<Map<String, Any>>()

  override fun definition() = ModuleDefinition {
    Name("ClawketQaViewport")
    // Merely loading/registering this module installs no listener.
    AsyncFunction("startAsync") { tag: Int, expectedGeneration: Int, optIn: Boolean ->
      start(tag, expectedGeneration, optIn)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopAsync") { expectedGeneration: Int ->
      if (generation == expectedGeneration) retire("manual")
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("readAsync") { expectedGeneration: Int ->
      if (generation != expectedGeneration) null else {
        expire()
        snapshot()
      }
    }.runOnQueue(Queues.MAIN)
    OnActivityEntersBackground { UiThreadUtil.runOnUiThread { retire("background") } }
    OnActivityDestroys { UiThreadUtil.runOnUiThread { retire("activity") } }
    OnDestroy { UiThreadUtil.runOnUiThread { retire("module") } }
  }

  private fun start(tag: Int, nextGeneration: Int, optIn: Boolean): String {
    if (!UiThreadUtil.isOnUiThread() || processUsed || tag <= 0 || nextGeneration !in 1..MAX || !optIn) return "unavailable"
    val context = appContext.reactContext as? ReactContext ?: return "unavailable"
    val version = ReactNativeVersion.VERSION
    if (context.packageName != "com.p697.clawket.qa"
      || context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0
      || version["major"] != 0 || version["minor"] != 86 || version["patch"] != 3
      || version["prerelease"] != null || !context.hasActiveReactInstance()) return "unavailable"
    try {
      val manager = UIManagerHelper.getUIManagerForReactTag(context, tag) as? FabricUIManager ?: return "unavailable"
      val host = manager.resolveView(tag) as? ReactScrollView ?: return "unavailable"
      val child = host.getChildAt(0) ?: return "unavailable"
      if (!host.isAttachedToWindow || !child.isAttachedToWindow) return "unavailable"
      val nativeDensity = host.resources.displayMetrics.density
      if (!nativeDensity.isFinite() || nativeDensity !in 0.1f..10f) return "unavailable"
      generation = nextGeneration
      density = nativeDensity
      started = SystemClock.uptimeMillis()
      ended = started
      sequence = 0; dropped = 0; rejected = 0; events.clear()
      status = "capturing"; reason = null
      processUsed = true
      val next = Binding(host, child, manager, nextGeneration)
      binding = next
      next.register()
      record(next, "bind_snapshot")
      return if (status == "capturing") "started" else "unavailable"
    } catch (_: Exception) {
      // Unknown partial registration is terminal. Never expose exception text.
      processUsed = true
      retire("unavailable")
      return "unavailable"
    }
  }

  private fun expire() {
    if (status == "capturing" && SystemClock.uptimeMillis() - started >= LIFETIME_MS) retire("expired")
  }

  private fun retire(why: String) {
    if (status != "capturing") return
    ended = SystemClock.uptimeMillis()
    status = "stopped"; reason = why
    val previous = binding
    binding = null // Retire before removing listeners; snapshot iteration may still call them.
    previous?.unregister()
  }

  private fun record(expected: Binding, phase: String) {
    // These identity checks use objects and a capture-local number, never an exported native tag.
    if (!UiThreadUtil.isOnUiThread() || binding !== expected || generation != expected.generation || status != "capturing") return
    var counted = false
    try {
      expire()
      if (binding !== expected) return
      val host = expected.host.get()
      val child = expected.child.get()
      if (host == null || child == null || !host.isAttachedToWindow || !child.isAttachedToWindow) { retire("detached"); return }
      if (host.getChildAt(0) !== child) { retire("replaced"); return }
      if (sequence == MAX) { retire("unavailable"); return }
      sequence += 1
      counted = true
      val dimensions = listOf(child.width, child.height, host.width, host.height)
      if (host.scrollY !in -MAX..MAX || dimensions.any { it < 0 || it > MAX }) { rejected += 1; retire("unavailable"); return }
      if (events.size == LIMIT) { events.removeFirst(); dropped += 1 }
      events.addLast(mapOf("sequence" to sequence, "elapsedMs" to (SystemClock.uptimeMillis() - started).coerceIn(0, LIFETIME_MS),
        "phase" to phase, "batchSequence" to expected.batch, "inMountBatch" to expected.inBatch,
        "offsetPx" to host.scrollY, "childWidthPx" to child.width, "childHeightPx" to child.height,
        "viewportWidthPx" to host.width, "viewportHeightPx" to host.height, "attached" to true))
    } catch (_: Exception) {
      if (!counted && sequence < MAX) { sequence += 1; counted = true }
      if (counted) rejected += 1
      retire("unavailable")
    }
  }

  private fun snapshot(): Map<String, Any?> = mapOf(
    "clockBasis" to "android_uptime_capture_elapsed", "status" to status, "reason" to reason,
    "generation" to generation, "density" to density, "elapsedMs" to (if (status == "capturing") SystemClock.uptimeMillis() else ended).let {
      (it - started).coerceIn(0, LIFETIME_MS)
    }, "sequence" to sequence, "dropped" to dropped, "rejected" to rejected,
    "events" to events.map { it.toMap() },
  )

  private inner class Binding(hostView: ReactScrollView, childView: View, private val manager: UIManager, val generation: Int) :
    ReactScrollViewHelper.ScrollListener, ReactScrollViewHelper.LayoutChangeListener, UIManagerListener, View.OnAttachStateChangeListener {
    val host = WeakReference(hostView)
    val child = WeakReference(childView)
    var batch = 0
    var inBatch = false

    fun register() {
      ReactScrollViewHelper.addScrollListener(this)
      ReactScrollViewHelper.addLayoutChangeListener(this)
      manager.addUIManagerEventListener(this)
      host.get()?.addOnAttachStateChangeListener(this)
    }
    fun unregister() {
      // Each removal is independent; cleanup must never throw on the UI thread.
      try { ReactScrollViewHelper.removeScrollListener(this) } catch (_: Exception) {}
      try { ReactScrollViewHelper.removeLayoutChangeListener(this) } catch (_: Exception) {}
      try { manager.removeUIManagerEventListener(this) } catch (_: Exception) {}
      try { host.get()?.removeOnAttachStateChangeListener(this) } catch (_: Exception) {}
    }
    override fun onLayout(scrollView: ViewGroup?) { if (scrollView === host.get()) record(this, "host_layout") }
    override fun onLayoutChange(scrollView: ViewGroup) { if (scrollView === host.get()) record(this, "child_layout") }
    override fun onScroll(scrollView: ViewGroup?, scrollEventType: ScrollEventType?, xVelocity: Float, yVelocity: Float) {
      if (scrollView !== host.get()) return
      val phase = when (scrollEventType) {
        ScrollEventType.SCROLL -> "scroll"
        ScrollEventType.BEGIN_DRAG -> "drag_begin"
        ScrollEventType.END_DRAG -> "drag_end"
        ScrollEventType.MOMENTUM_BEGIN -> "momentum_begin"
        ScrollEventType.MOMENTUM_END -> "momentum_end"
        else -> return
      }
      record(this, phase)
    }
    override fun willMountItems(uiManager: UIManager) {
      if (!UiThreadUtil.isOnUiThread() || binding !== this || generation != this@ClawketQaViewportModule.generation || uiManager !== manager) return
      if (batch == MAX) { retire("unavailable"); return }
      batch += 1; inBatch = true; record(this, "mount_begin")
    }
    override fun didMountItems(uiManager: UIManager) {
      if (!UiThreadUtil.isOnUiThread() || binding !== this || generation != this@ClawketQaViewportModule.generation || uiManager !== manager) return
      inBatch = false; record(this, "mount_end")
    }
    override fun willDispatchViewUpdates(uiManager: UIManager) {}
    override fun didDispatchMountItems(uiManager: UIManager) {}
    override fun didScheduleMountItems(uiManager: UIManager) {}
    override fun onViewAttachedToWindow(view: View) {} // Never rearm a retired capture.
    override fun onViewDetachedFromWindow(view: View) {
      if (UiThreadUtil.isOnUiThread() && binding === this && generation == this@ClawketQaViewportModule.generation && view === host.get()) retire("detached")
    }
  }
}
