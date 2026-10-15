import java.util.Properties

plugins {
    id("com.android.application")
}

// 버전은 데스크톱 앱과 같이 package.json 하나에서 정한다. 1.2.3 → versionCode 10203.
val appVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val appVersionCode: Int = appVersion.split(".").map { it.toInt() }.let { (major, minor, patch) -> major * 10000 + minor * 100 + patch }

// 서명 키는 저장소 밖(사용자 폴더의 .chartdesk)에 둔다. android-signing.properties에 키 파일 이름과 비밀번호가 있다.
// 업데이트는 같은 키로 서명한 APK만 설치되므로 키를 잃어버리면 앱을 지우고 다시 깔아야 한다. 이 폴더는 따로 백업한다.
val signingDir = File(System.getProperty("user.home"), ".chartdesk")
val signing = Properties().apply {
    val file = File(signingDir, "android-signing.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.sunya0804.chartdesk"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sunya0804.chartdesk"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (signing.isNotEmpty()) {
            create("release") {
                storeFile = File(signingDir, signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    // 화면은 데스크톱 앱과 같은 public 폴더를 그대로 쓴다.
    sourceSets {
        getByName("main") {
            assets.directories.add("../../public")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
