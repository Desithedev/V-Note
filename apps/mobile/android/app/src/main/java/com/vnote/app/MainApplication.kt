package com.vnote.app

import android.app.Application
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.vnote.phovoice.PhoVoicePackage

class MainApplication : Application(), ReactApplication {

    private val TAG = "VNoteApp"

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            // Luon luon tat developer support de ung dung hoat dong offline doc lap,
            // khong tim kiem Metro bundler qua localhost:8081 gay man hinh den tren dien thoai.
            override fun getUseDeveloperSupport(): Boolean = false

            override fun getPackages(): List<ReactPackage> {
                val packages = mutableListOf<ReactPackage>(
                    MainReactPackage(),
                    PhoVoicePackage()
                )
                try {
                    val asyncStorageClass = Class.forName("com.reactnativecommunity.asyncstorage.AsyncStoragePackage")
                    packages.add(asyncStorageClass.getDeclaredConstructor().newInstance() as ReactPackage)
                } catch (e: Throwable) {
                    Log.w(TAG, "AsyncStoragePackage could not be loaded via reflection: ${e.message}")
                }
                return packages
            }

            override fun getJSMainModuleName(): String = "index"
            override fun getBundleAssetName(): String = "index.android.bundle"

            override val isNewArchEnabled: Boolean = false
            override val isHermesEnabled: Boolean = true
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()

        // Bat loi crash toan cuc
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            Log.e(TAG, "FATAL CRASH in thread ${thread.name}: ${throwable.message}", throwable)
        }

        try {
            // Khoi tao SoLoader voi OpenSourceMergedSoMapping cho React Native 0.76+
            SoLoader.init(this, OpenSourceMergedSoMapping)
            Log.i(TAG, "SoLoader initialized with OpenSourceMergedSoMapping successfully.")
        } catch (e: Throwable) {
            Log.w(TAG, "OpenSourceMergedSoMapping init fallback: ${e.message}")
            try {
                SoLoader.init(this, false)
            } catch (ignored: Throwable) {
            }
        }
    }
}
