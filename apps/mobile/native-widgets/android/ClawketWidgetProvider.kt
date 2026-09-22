package __PACKAGE__.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.util.SizeF
import android.util.TypedValue
import android.widget.RemoteViews
import kotlin.math.roundToInt
import __PACKAGE__.R

class ClawketWidgetProvider : AppWidgetProvider() {
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    onUpdate(context, manager, intArrayOf(id))
  }
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { id ->
      val options = manager.getAppWidgetOptions(id)
      // One UI and other launchers scale the host independently of display density.
      // Size the controls to the actual widget, rather than centering a fixed strip.
      @Suppress("DEPRECATION")
      val sizes = if (Build.VERSION.SDK_INT >= 31)
        options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
          ?.filter { it.width > 0 && it.height > 0 }?.distinct()?.take(16)
      else null
      val views = if (!sizes.isNullOrEmpty() && Build.VERSION.SDK_INT >= 31) {
        RemoteViews(sizes.associateWith { createViews(context, it.width, it.height) })
      } else {
        createViews(context, options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300).toFloat(),
          options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180).toFloat())
      }
      manager.updateAppWidget(id, views)
    }
  }

  private fun createViews(context: Context, width: Float, height: Float): RemoteViews {
    val narrow = width < 260
    val views = RemoteViews(context.packageName, if (narrow) R.layout.clawket_widget_small else R.layout.clawket_widget)
    val actions = if (narrow) {
      listOf(R.id.widget_camera to "camera", R.id.widget_voice to "voice")
    } else {
      listOf(R.id.widget_camera to "camera", R.id.widget_photos to "photos",
        R.id.widget_voice to "voice", R.id.widget_skills to "skills")
    }
    if (Build.VERSION.SDK_INT >= 31) {
      val inset = (width * 0.05f).coerceIn(12f, 22f)
      val gap = (height * 0.065f).coerceIn(10f, 16f)
      val count = if (narrow) 2 else 4
      val diameter = minOf((width - inset * 2 - gap * (count - 1)) / count,
        (height - inset * 2 - gap) / 2, if (narrow) 76f else 80f).coerceAtLeast(40f)
      val pill = minOf(height - inset * 2 - gap - diameter, diameter + 8f, 80f).coerceAtLeast(48f)
      val verticalInset = ((height - pill - gap - diameter) / 2).coerceAtLeast(8f)
      fun px(dp: Float) = (dp * context.resources.displayMetrics.density).roundToInt()
      fun size(view: Int, w: Float? = null, h: Float? = null) {
        w?.let { views.setViewLayoutWidth(view, it, TypedValue.COMPLEX_UNIT_DIP) }
        h?.let { views.setViewLayoutHeight(view, it, TypedValue.COMPLEX_UNIT_DIP) }
      }
      views.setViewPadding(R.id.widget_root, px(inset), px(verticalInset), px(inset), px(verticalInset))
      size(R.id.widget_chat, h = pill)
      size(R.id.widget_actions, h = diameter)
      views.setViewLayoutMargin(R.id.widget_actions, RemoteViews.MARGIN_TOP, gap, TypedValue.COMPLEX_UNIT_DIP)
      val avatar = (pill * 0.65f).coerceIn(32f, 50f)
      size(R.id.widget_mark, avatar, avatar)
      val pillInset = (pill - avatar) / 2
      views.setViewPadding(R.id.widget_chat, px(pillInset), 0, px(pillInset), 0)
      views.setTextViewTextSize(R.id.widget_prompt, TypedValue.COMPLEX_UNIT_SP, if (narrow) 18f else 20f)
      actions.forEach { (view, _) ->
        size(view, diameter, diameter)
        val padding = px(diameter * 0.28f)
        views.setViewPadding(view, padding, padding, padding, padding)
      }
    }
    (actions + (R.id.widget_chat to "chat")).forEach { (viewId, action) ->
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("clawket://widget?action=$action"))
        .setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      views.setOnClickPendingIntent(viewId, PendingIntent.getActivity(context, viewId, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    return views
  }
}
