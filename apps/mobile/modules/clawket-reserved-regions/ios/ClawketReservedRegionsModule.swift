import ExpoModulesCore
import UIKit

public final class ClawketReservedRegionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ClawketReservedRegions")
    View(ClawketReservedRegionsView.self) {
      Events("onRegionsChange")
      OnViewDidUpdateProps { (view: ClawketReservedRegionsView) in
        view.didPrepareProps()
      }
    }
  }
}

final class ClawketReservedRegionsView: ExpoView {
  let onRegionsChange = EventDispatcher()
  private var previousSnapshot: NSDictionary?
  private var propsReady = false

  func didPrepareProps() {
    propsReady = true
    setNeedsLayout()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    previousSnapshot = nil
    setNeedsLayout()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard propsReady, window != nil, bounds.width > 0, bounds.height > 0 else { return }
    // Never skip querying because bounds stayed equal: folding can change only regions.
    let snapshot: [String: Any] = [
      "width": bounds.width, "height": bounds.height,
      "regions": ClawketActiveReservedRegions(self)
    ]
    let comparable = snapshot as NSDictionary
    guard previousSnapshot?.isEqual(comparable) != true else { return }
    previousSnapshot = comparable
    onRegionsChange(snapshot)
  }
}
