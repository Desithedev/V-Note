package com.vnote.app

import android.app.Application
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.shell.MainReactPackage
import com.facebook.soloader.SoLoader
import com.vnote.phovoice.PhoVoicePackage

class MainApplication : Application(), ReactApplication {

    private val mReactNativeHost = object : ReactNativeHost(this) {
        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override fun getPackages(): List<ReactPackage> {
            val packages = mutableListOf<ReactPackage>(
                MainReactPackage(),
                PhoVoicePackage()
            )
            try {
                val asyncStorageClass = Class.forName("com.reactnativecommunity.asyncstorage.AsyncStoragePackage")
                packages.add(asyncStorageClass.getDeclaredConstructor().newInstance() as ReactPackage)
            } catch (ignored: Throwable) {
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
        SoLoader.init(this, false)
    }
}
