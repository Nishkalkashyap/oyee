import Foundation

/// Shared JSON coding configuration for the Herald protocol.
///
/// Timestamps are ISO-8601 strings in UTC (`2026-10-28T10:00:00.000Z`). We accept them with or without
/// fractional seconds and with any offset, and always encode them with milliseconds in UTC.
public enum HeraldJSON {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            guard let date = parseDate(string) else {
                throw DecodingError.dataCorruptedError(
                    in: container, debugDescription: "Invalid ISO-8601 date: \(string)")
            }
            return date
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatDate(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    private static let fractionalStyle = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let plainStyle = Date.ISO8601FormatStyle()

    /// Parses an ISO-8601 timestamp with or without fractional seconds and with `Z` or a `±hh:mm` offset.
    public static func parseDate(_ string: String) -> Date? {
        let trimmed = string.trimmingCharacters(in: .whitespaces)
        if let date = try? fractionalStyle.parse(trimmed) { return date }
        if let date = try? plainStyle.parse(trimmed) { return date }
        // Fall back to normalising fractional seconds of arbitrary precision (e.g. microseconds).
        if let regex = try? NSRegularExpression(pattern: #"\.(\d+)"#),
           let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
           let range = Range(match.range(at: 1), in: trimmed) {
            var digits = String(trimmed[range])
            digits = String((digits + "000").prefix(3))
            let normalised = trimmed.replacingCharacters(in: range, with: digits)
            if let date = try? fractionalStyle.parse(normalised) { return date }
        }
        return nil
    }

    /// Formats a date as `2026-10-28T10:00:00.000Z`.
    public static func formatDate(_ date: Date) -> String {
        fractionalStyle.format(date)
    }
}

/// Decoding helpers that tolerate missing keys and `null`s by falling back to defaults.
extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key, default fallback: @autoclosure () -> T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback()
    }

    func optional<T: Decodable>(_ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }

    /// Decodes an array, dropping elements that fail to decode instead of failing the whole array.
    func lossyArray<T: Decodable>(_ key: Key) -> [T] {
        guard let wrapped = try? decodeIfPresent([LossyElement<T>].self, forKey: key) else { return [] }
        return wrapped.compactMap(\.value)
    }
}

struct LossyElement<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}
