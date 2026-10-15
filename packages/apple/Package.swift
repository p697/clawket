// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ClawketApple",
    platforms: [.iOS("16.4"), .macOS(.v13)],
    products: [
        .library(name: "ClawketTransport", targets: ["ClawketTransport"]),
        .library(name: "ClawketPairing", targets: ["ClawketPairing"]),
        .library(name: "ClawketUI", targets: ["ClawketUI"]),
        .library(name: "ClawketRuntime", targets: ["ClawketRuntime"]),
        .library(name: "ClawketPersistence", targets: ["ClawketPersistence"]),
        .library(name: "ClawketUpgrade", targets: ["ClawketUpgrade"]),
    ],
    dependencies: [
        .package(url: "https://github.com/jedisct1/swift-sodium.git", exact: "0.11.0"),
    ],
    targets: [
        .target(name: "ClawketTransport"),
        .target(name: "ClawketPairing", dependencies: ["ClawketTransport", .product(name: "Sodium", package: "swift-sodium")]),
        .target(name: "ClawketUI", exclude: ["AGENTS.md", "CLAUDE.md"]),
        .testTarget(name: "ClawketUITests", dependencies: ["ClawketUI"]),
        .target(name: "ClawketRuntime", dependencies: ["ClawketTransport", "ClawketPairing"]),
        .target(name: "ClawketPersistence", exclude: ["AGENTS.md", "CLAUDE.md"]),
        .testTarget(name: "ClawketPersistenceTests", dependencies: ["ClawketPersistence"]),
        .target(name: "ClawketUpgrade", dependencies: ["ClawketPairing", "ClawketPersistence"], exclude: ["AGENTS.md", "CLAUDE.md"]),
        .testTarget(name: "ClawketUpgradeTests", dependencies: ["ClawketUpgrade", "ClawketPairing", "ClawketPersistence"]),
        .testTarget(name: "ClawketTransportTests", dependencies: ["ClawketTransport"]),
        .testTarget(name: "ClawketRuntimeTests", dependencies: ["ClawketRuntime", "ClawketTransport", "ClawketPairing"]),
        .testTarget(name: "ClawketPairingTests", dependencies: ["ClawketPairing", "ClawketTransport", .product(name: "Sodium", package: "swift-sodium")], resources: [.copy("Fixtures")]),
    ]
)
