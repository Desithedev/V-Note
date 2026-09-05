package com.vnote.app

import android.app.Application
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.vnote.phovoice.PhoVoicePackage

class MainApplication : Application(), ReactApplication {

    private val TAG = "VNoteApp"

    private val mReactNativeHost = object : ReactNativeHost(this) {
        // Luon luon tat developer support de ung dung hoat dong offline doc lap,
        // khong co tim kiem Metro bundler qua localhost:8081 gay crash tren dien thoai.
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
    }

    override val reactNativeHost: ReactNativeHost
        get() = mReactNativeHost

    override fun onCreate() {
        super.onCreate()

        // Bắt lỗi crash toàn cục để tránh app bị tắt đột ngột mà không có log
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            Log.e(TAG, "FATAL CRASH in thread ${thread.name}: ${throwable.message}", throwable)
        }

        try {
            // Khoi tao SoLoader voi OpenSourceMergedSoMapping cho React Native 0.76+
            // giup nap chinh xac file libreactnative.so da hop nhat
            SoLoader.init(this, OpenSourceMergedSoMapping)
            Log.i(TAG, "SoLoader initialized with OpenSourceMergedSoMapping successfully.")
        } catch (e: Throwable) {
            Log.w(TAG, "OpenSourceMergedSoMapping init failed, falling back to legacy SoLoader: ${e.message}")
            try {
                SoLoader.init(this, false)
            } catch (ex: Throwable) {
                Log.e(TAG, "Legacy SoLoader init failed: ${ex.message}", ex)
            }
        }
    }
}
