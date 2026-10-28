import SwiftUI

/// SwiftUI's `State` property wrapper, used through a typealias.
///
/// In the macOS 27 / iOS 27 SDKs `@State` is a macro implemented by the `SwiftUIMacros` compiler plugin, which ships
/// with Xcode but **not** with the Command Line Tools. Spelling it `@ViewState` resolves to the (still available)
/// `State<Value>` property wrapper instead of the macro, so the app builds with `swift build` and no Xcode. It behaves
/// exactly like `@State`.
public typealias ViewState<Value> = SwiftUI.State<Value>
