const {
  applyPasteInputSetup,
  applyPasteInputBridgingHeader,
} = require('./with-paste-input-setup.js') as {
  applyPasteInputSetup: (contents: string) => string;
  applyPasteInputBridgingHeader: (contents: string) => string;
};

const APP_DELEGATE = `internal import Expo
import React

@main
class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: ReactNativeDelegate())
#if os(iOS) || os(tvOS)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    return true
  }
}
`;

const BRIDGING_HEADER = '// Clawket bridging header\n';

describe('withPasteInputSetup', () => {
  it('registers the root view factory after React Native starts', () => {
    const output = applyPasteInputSetup(APP_DELEGATE);
    expect(output).toContain('PasteInputModule.setup(factory.rootViewFactory)');
    expect(output).not.toContain('import react_native_paste_input');
    expect(output.indexOf('factory.startReactNative('))
      .toBeLessThan(output.indexOf('PasteInputModule.setup(factory.rootViewFactory)'));
    expect(output.indexOf('PasteInputModule.setup(factory.rootViewFactory)'))
      .toBeLessThan(output.indexOf('#endif'));
  });

  it('is idempotent for both generated files', () => {
    const delegateOnce = applyPasteInputSetup(APP_DELEGATE);
    expect(applyPasteInputSetup(delegateOnce)).toBe(delegateOnce);
    const headerOnce = applyPasteInputBridgingHeader(BRIDGING_HEADER);
    expect(applyPasteInputBridgingHeader(headerOnce)).toBe(headerOnce);
  });

  it('exposes the Objective-C module to Swift', () => {
    expect(applyPasteInputBridgingHeader(BRIDGING_HEADER))
      .toContain('#import <react-native-paste-input/PasteInputModule.h>');
  });

  it('fails closed when the Expo anchor drifts or duplicates', () => {
    expect(() => applyPasteInputSetup(APP_DELEGATE.replace(
      'launchOptions: launchOptions)',
      'launchOptions: options)',
    ))).toThrow(/missing the expected paste-input anchor/);
    expect(() => applyPasteInputSetup(APP_DELEGATE.replace(
      '#endif',
      '    launchOptions: launchOptions)\n#endif',
    ))).toThrow(/more than one paste-input anchor/);
  });

  it('fails closed when the AppDelegate no longer creates a React Native factory', () => {
    expect(() => applyPasteInputSetup(`import UIKit
@main class AppDelegate: UIResponder {
  launchOptions: launchOptions)
}
`)).toThrow(/does not create a React Native factory/);
  });

  it('fails closed for truncated generated blocks', () => {
    const truncatedDelegate = applyPasteInputSetup(APP_DELEGATE)
      .replace('// @generated end clawket-paste-input-setup', '');
    expect(() => applyPasteInputSetup(truncatedDelegate)).toThrow(/incomplete generated/);
    const truncatedHeader = applyPasteInputBridgingHeader(BRIDGING_HEADER)
      .replace('// @generated end clawket-paste-input-import', '');
    expect(() => applyPasteInputBridgingHeader(truncatedHeader)).toThrow(/incomplete generated/);
  });
});
