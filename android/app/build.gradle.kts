import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Optional release signing: create android/keystore.properties (see docs/FIRE_TV_INSTALL.md)
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "tv.lttv.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "tv.lttv.app"
        minSdk = 22          // Fire OS 5 (Fire TV Stick 2nd gen) and newer
        targetSdk = 34
        // Every GitHub build gets a higher number, so a new APK installs over the old one.
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        // Version numbers count from 1.0.0 = build 33 (numbering restarted); each pushed build adds 1.
        versionName = "1.0.${((System.getenv("GITHUB_RUN_NUMBER") ?: "33").toInt() - 33).coerceAtLeast(0)}"
    }

    signingConfigs {
        // One fixed debug key (in the repo) so every build — on any machine or GitHub runner —
        // can update the app already on the TV without uninstalling it (and losing its data).
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        if (keystoreProps.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProps.containsKey("storeFile")) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    val media3 = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-exoplayer-dash:$media3")
    implementation("androidx.media3:media3-datasource:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
}

// The TV UI is the same web bundle as the desktop app. Build it first with
// `npm run build:android` (copies dist/ into src/main/assets/www). This task
// fails early with a clear message if that step was skipped.
val checkWebAssets by tasks.registering {
    doLast {
        val index = file("src/main/assets/www/index.html")
        if (!index.exists()) {
            throw GradleException("Web UI missing: run `npm install && npm run build:android` in the project root first.")
        }
    }
}
tasks.named("preBuild") { dependsOn(checkWebAssets) }
