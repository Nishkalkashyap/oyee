import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// FCM is optional at build time. The google-services plugin is applied only when the config file exists, so the
// app builds (and falls back to the WebSocket transport) without it.
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
}

// Override with -PheraldServerUrl=https://my-herald.example.com or in ~/.gradle/gradle.properties.
val defaultServerUrl = (findProperty("heraldServerUrl") as String?) ?: "https://push.nishkal.in"

// Release signing comes from the environment (GitHub Actions secrets, see .github/workflows/release.yml). Every
// published APK must be signed with the same key, or Android refuses to install it as an update.
val releaseKeystore = System.getenv("HERALD_KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }

// CI passes the tag's version: -PheraldVersionName=0.2.0 -PheraldVersionCode=200.
val heraldVersionName = (findProperty("heraldVersionName") as String?) ?: "0.1.0"
val heraldVersionCode = (findProperty("heraldVersionCode") as String?)?.toInt() ?: 1

android {
    namespace = "dev.herald.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.herald.android"
        minSdk = 26
        targetSdk = 36
        versionCode = heraldVersionCode
        versionName = heraldVersionName

        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
        buildConfigField("boolean", "HAS_GOOGLE_SERVICES", hasGoogleServices.toString())
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("HERALD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("HERALD_KEY_ALIAS")
                keyPassword = System.getenv("HERALD_KEY_PASSWORD")
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
