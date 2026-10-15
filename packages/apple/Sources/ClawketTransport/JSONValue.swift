import Foundation

/// Protocol data only. Never use this value as a diagnostic or analytics field.
public enum JSONValue: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? value.decode(Double.self), number.isFinite { self = .number(number) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else if let array = try? value.decode([JSONValue].self) { self = .array(array) }
        else { self = .object(try value.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let bool): try value.encode(bool)
        case .number(let number): try value.encode(number)
        case .string(let string): try value.encode(string)
        case .array(let array): try value.encode(array)
        case .object(let object): try value.encode(object)
        }
    }

    public subscript(_ key: String) -> JSONValue? {
        guard case .object(let object) = self else { return nil }
        return object[key]
    }

    public var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    public var boolValue: Bool? {
        guard case .bool(let value) = self else { return nil }
        return value
    }

    public var numberValue: Double? {
        guard case .number(let value) = self else { return nil }
        return value
    }
}

public enum FrameValidationError: Error, Sendable, Equatable {
    case tooLarge
    case invalidUTF8
    case invalidJSON
    case nestingLimit
    case valueLimit
}

public enum FrameCodec {
    public static let maximumFrameBytes = 8 * 1_024 * 1_024
    public static let maximumJSONDepth = 64
    public static let maximumJSONTokens = 250_000

    public static func validateSize(_ text: String) throws {
        guard text.utf8.count <= maximumFrameBytes else { throw FrameValidationError.tooLarge }
    }

    public static func text(from frame: WebSocketFrame) throws -> String {
        switch frame {
        case .text(let text):
            try validateSize(text)
            return text
        case .binary(let data):
            guard data.count <= maximumFrameBytes else { throw FrameValidationError.tooLarge }
            guard let text = String(data: data, encoding: .utf8) else { throw FrameValidationError.invalidUTF8 }
            return text
        }
    }

    public static func decode(_ text: String) throws -> JSONValue {
        try validateSize(text)
        // Check nesting before recursive decoding; braces inside strings are data.
        var depth = 0
        var inString = false
        var escaped = false
        var literal = false
        var tokens = 0
        for byte in text.utf8 {
            if inString {
                if escaped { escaped = false }
                else if byte == 0x5C { escaped = true }
                else if byte == 0x22 { inString = false }
            } else if byte == 0x22 {
                inString = true
                literal = false
                tokens += 1
            } else if byte == 0x5B || byte == 0x7B {
                literal = false
                tokens += 1
                depth += 1
                guard depth <= maximumJSONDepth else { throw FrameValidationError.nestingLimit }
            } else if byte == 0x5D || byte == 0x7D {
                literal = false
                depth -= 1
                guard depth >= 0 else { throw FrameValidationError.invalidJSON }
            } else if byte == 0x2C || byte == 0x3A || byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D {
                literal = false
            } else if !literal {
                literal = true
                tokens += 1
            }
            guard tokens <= maximumJSONTokens else { throw FrameValidationError.valueLimit }
        }
        guard depth == 0, !inString else { throw FrameValidationError.invalidJSON }
        do { return try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
        catch { throw FrameValidationError.invalidJSON }
    }

    public static func encode(_ value: JSONValue) throws -> String {
        // Validate before JSONEncoder recursively walks caller-supplied values.
        var tokens = 0
        try validate(value, depth: 0, tokens: &tokens)
        let data: Data
        do { data = try JSONEncoder().encode(value) }
        catch { throw FrameValidationError.invalidJSON }
        guard data.count <= maximumFrameBytes else { throw FrameValidationError.tooLarge }
        return String(decoding: data, as: UTF8.self)
    }

    private static func validate(_ value: JSONValue, depth: Int, tokens: inout Int) throws {
        tokens += 1
        guard tokens <= maximumJSONTokens else { throw FrameValidationError.valueLimit }
        switch value {
        case .array(let values):
            guard depth < maximumJSONDepth else { throw FrameValidationError.nestingLimit }
            for value in values { try validate(value, depth: depth + 1, tokens: &tokens) }
        case .object(let values):
            guard depth < maximumJSONDepth else { throw FrameValidationError.nestingLimit }
            tokens += values.count // Object keys are strings too.
            guard tokens <= maximumJSONTokens else { throw FrameValidationError.valueLimit }
            for value in values.values { try validate(value, depth: depth + 1, tokens: &tokens) }
        case .number(let value):
            guard value.isFinite else { throw FrameValidationError.invalidJSON }
        case .null, .bool, .string: break
        }
    }
}
