package app.oyee.android.data

import app.oyee.android.model.ApiErrorBody
import app.oyee.android.model.OyeeJson
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.Page
import app.oyee.android.model.PairInput
import app.oyee.android.model.PairResult
import app.oyee.android.model.ReadAllResult
import app.oyee.android.model.ServerConfig
import app.oyee.android.model.Severity
import app.oyee.android.model.SourceList
import app.oyee.android.model.SourceSummary
import app.oyee.android.model.User
import app.oyee.android.model.Device
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class OyeeApiException(
    val status: Int,
    val code: String,
    override val message: String,
) : IOException(message) {
    val isUnauthorized get() = status == 401
    val isNotFound get() = status == 404

    /** 409: e.g. answering an ask that was already answered, expired or withdrawn. Final: retrying can't succeed. */
    val isConflict get() = status == 409
}

data class NotificationQuery(
    val limit: Int = 50,
    val cursor: String? = null,
    val source: String? = null,
    val severity: Severity? = null,
    val status: NotificationStatus? = null,
    val q: String? = null,
    val updatedSince: String? = null,
)

/**
 * REST client for protocol §3. Every call takes the server + token explicitly via [Session] so the client is
 * stateless; [onUnauthorized] is invoked on 401 from authenticated calls (device revoked from the web app).
 */
class OyeeApi(
    private val client: OkHttpClient,
    private val onUnauthorized: suspend () -> Unit,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    // ── Pairing (no auth) ──
    suspend fun pair(serverUrl: String, code: String, name: String): PairResult {
        val body = OyeeJson.encodeToString(PairInput.serializer(), PairInput(code, name, "android"))
        val req = Request.Builder().url(url(serverUrl, "api/devices/pair")).post(body.toRequestBody(jsonType)).build()
        return execute(req, PairResult.serializer(), authed = false)
    }

    suspend fun config(serverUrl: String): ServerConfig =
        execute(Request.Builder().url(url(serverUrl, "api/config")).get().build(), ServerConfig.serializer(), authed = false)

    // ── Me / devices ──
    suspend fun me(s: Session): User = get(s, "api/me", User.serializer())

    suspend fun updateSelf(s: Session, fcmToken: String?, name: String? = null): Device {
        val body = buildJsonObject {
            name?.let { put("name", it) }
            put("fcmToken", fcmToken) // explicit null clears the token server-side
        }
        return send(s, "PUT", "api/devices/self", body, Device.serializer())
    }

    suspend fun deleteSelf(s: Session) = sendNoContent(s, "DELETE", "api/devices/self")

    // ── Notifications ──
    suspend fun list(s: Session, q: NotificationQuery): Page<Notification> {
        val u = url(s.serverUrl, "api/notifications").newBuilder().apply {
            addQueryParameter("limit", q.limit.toString())
            q.cursor?.let { addQueryParameter("cursor", it) }
            q.source?.let { addQueryParameter("source", it) }
            q.severity?.let { addQueryParameter("severity", it.wire) }
            q.status?.let { addQueryParameter("status", it.wire) }
            q.q?.takeIf { it.isNotBlank() }?.let { addQueryParameter("q", it) }
            q.updatedSince?.let { addQueryParameter("updatedSince", it) }
        }.build()
        return execute(authed(s, u).get().build(), Page.serializer(Notification.serializer()))
    }

    suspend fun get(s: Session, id: String): Notification = get(s, "api/notifications/${seg(id)}", Notification.serializer())

    /**
     * Answers an ask with one of its answer buttons ([option], the label) or a text reply. The first answer from any
     * device wins; a later one gets `409 conflict` ([OyeeApiException.isConflict]).
     */
    suspend fun respond(s: Session, id: String, option: String? = null, text: String? = null): Notification {
        require(option != null || text != null) { "option or text is required" }
        val body = buildJsonObject {
            option?.let { put("option", it) }
            text?.let { put("text", it) }
        }
        return send(s, "POST", "api/notifications/${seg(id)}/respond", body, Notification.serializer())
    }

    suspend fun markRead(s: Session, id: String): Notification =
        send(s, "POST", "api/notifications/${seg(id)}/read", JsonObject(emptyMap()), Notification.serializer())

    suspend fun readAll(s: Session, source: String? = null): ReadAllResult =
        send(s, "POST", "api/notifications/read-all", buildJsonObject { source?.let { put("source", it) } }, ReadAllResult.serializer())

    suspend fun resolve(s: Session, id: String): Notification =
        send(s, "POST", "api/notifications/${seg(id)}/resolve", JsonObject(emptyMap()), Notification.serializer())

    suspend fun delete(s: Session, id: String) = sendNoContent(s, "DELETE", "api/notifications/${seg(id)}")

    suspend fun sources(s: Session): List<SourceSummary> = get(s, "api/sources", SourceList.serializer()).items

    // ── plumbing ──
    private fun seg(id: String) = java.net.URLEncoder.encode(id, "UTF-8").replace("+", "%20")

    fun url(serverUrl: String, path: String): HttpUrl = (serverUrl.trimEnd('/') + "/" + path).toHttpUrl()

    private fun authed(s: Session, u: HttpUrl) = Request.Builder().url(u).header("Authorization", "Bearer ${s.token}")

    private suspend fun <T> get(s: Session, path: String, ser: KSerializer<T>): T =
        execute(authed(s, url(s.serverUrl, path)).get().build(), ser)

    private suspend fun <T> send(s: Session, method: String, path: String, body: JsonObject, ser: KSerializer<T>): T =
        execute(authed(s, url(s.serverUrl, path)).method(method, body.toString().toRequestBody(jsonType)).build(), ser)

    private suspend fun sendNoContent(s: Session, method: String, path: String) {
        val rb: RequestBody? = if (method == "DELETE") null else "{}".toRequestBody(jsonType)
        executeRaw(authed(s, url(s.serverUrl, path)).method(method, rb).build(), authed = true)
    }

    private suspend fun <T> execute(req: Request, ser: KSerializer<T>, authed: Boolean = true): T =
        OyeeJson.decodeFromString(ser, executeRaw(req, authed))

    private suspend fun executeRaw(req: Request, authed: Boolean): String {
        try {
            return withContext(Dispatchers.IO) {
                client.newCall(req).execute().use { resp ->
                    val text = resp.body.string()
                    if (!resp.isSuccessful) {
                        val err = runCatching { OyeeJson.decodeFromString(ApiErrorBody.serializer(), text).error }.getOrNull()
                        throw OyeeApiException(
                            status = resp.code,
                            code = err?.code ?: "http_${resp.code}",
                            message = err?.message?.takeIf { it.isNotBlank() } ?: "HTTP ${resp.code}",
                        )
                    }
                    text
                }
            }
        } catch (e: OyeeApiException) {
            // 401 on a device-token call = the device was revoked (e.g. removed in the web app).
            if (authed && e.isUnauthorized) onUnauthorized()
            throw e
        }
    }
}
