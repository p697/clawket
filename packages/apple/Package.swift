// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ClawketApple",
    platforms: [.iOS("16.4"), .macOS(.v13)],
    products: [
        .library(name: "ClawketTransport", targets: ["ClawketTransport"]),
        .library(name: "ClawketPairing", targets: ["ClawketPairing"]),
    ],
    dependencies: [
        .package(url: "https://github.com/jedisct1/swift-sodium.git", exact: "0.11.0"),
    ],
    targets: [
        .target(name: "ClawketTransport"),
        .target(name: "ClawketPairing", dependencies: ["ClawketTransport", .product(name: "Sodium", package: "swift-sodium")]),
        .testTarget(name: "ClawketTransportTests", dependencies: ["ClawketTransport"]),
        .testTarget(name: "ClawketPairingTests", dependencies: ["ClawketPairing", "ClawketTransport", .product(name: "Sodium", package: "swift-sodium")], resources: [.copy("Fixtures")]),
    ]
)
