import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// FCM is optional at build time. The google-services plugin is applied only when the config file exists, so the
// app builds (and falls back to the WebSocket transport) without it.
// It must list this app's package; a config for another package (e.g. before re-registering in Firebase) is ignored.
val hasGoogleServices = file("google-services.json").let { it.exists() && it.readText().contains("\"app.oyee.android\"") }
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
}

// Override with -PoyeeServerUrl=https://my-oyee.example.com or in ~/.gradle/gradle.properties.
val defaultServerUrl = (findProperty("oyeeServerUrl") as String?) ?: "https://oyee.app"

// Release signing comes from the environment (GitHub Actions secrets, see .github/workflows/release.yml). Every
// published APK must be signed with the same key, or Android refuses to install it as an update.
val releaseKeystore = System.getenv("OYEE_KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }

// CI passes the tag's version: -PoyeeVersionName=0.2.0 -PoyeeVersionCode=200.
val oyeeVersionName = (findProperty("oyeeVersionName") as String?) ?: "0.1.0"
val oyeeVersionCode = (findProperty("oyeeVersionCode") as String?)?.toInt() ?: 1

android {
    namespace = "app.oyee.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.oyee.android"
        minSdk = 26
        targetSdk = 36
        versionCode = oyeeVersionCode
        versionName = oyeeVersionName

        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
        buildConfigField("boolean", "HAS_GOOGLE_SERVICES", hasGoogleServices.toString())
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("OYEE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("OYEE_KEY_ALIAS")
                keyPassword = System.getenv("OYEE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            // For local development and self-builds. Cleartext to local hosts is allowed by the debug-only network
            // security config + ServerUrl validation.
            isMinifyEnabled = false
        }
        release {
            // Published on GitHub Releases, signed with the release key. HTTPS only.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        // Sideloaded app: Play-policy checks (e.g. battery-optimization exemption request) are informational.
        disable += setOf("BatteryLife")
        abortOnError = true
        checkDependencies = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        optIn.add("kotlinx.serialization.ExperimentalSerializationApi")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime.ktx)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    debugImplementation(libs.compose.ui.tooling)

    // Always compiled in; only initialised at runtime when google-services.json was present at build time.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
