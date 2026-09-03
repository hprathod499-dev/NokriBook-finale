package com.nokribook.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

// Loads index.html (bundled inside app/src/main/assets/, the same file
// content as web-assets/index.html) through WebViewAssetLoader's virtual
// https://appassets.androidplatform.net/ origin. This is what lets the
// app's Firebase Auth / Firestore / Google sign-in calls work correctly —
// a raw file:// origin blocks or badly restricts exactly that kind of
// network and storage access.
//
// Everything the app does at runtime (Firestore reads/writes, Auth,
// Drive backup, WhatsApp share links, etc.) still goes out over the real
// internet as normal — only the initial HTML/JS/CSS/icons are served
// locally from what's bundled in this APK.
public class MainActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The path handler prefix must be "/assets/" (matching Google's
        // own documented WebViewAssetLoader usage), not "/" — AssetsPathHandler
        // resolves whatever comes AFTER the matched prefix directly
        // against the assets/ folder (via context.getAssets().open(...)),
        // so it expects to receive "index.html", not "assets/index.html".
        // With the prefix previously registered at "/", loadUrl's
        // ".../assets/index.html" request left "assets/index.html" as the
        // remainder, which AssetsPathHandler then looked for as
        // assets/assets/index.html — a path that doesn't exist, since
        // assets are flat (app/src/main/assets/index.html). That failure
        // to open the asset is what surfaced as net::ERR_INVALID_RESPONSE
        // in the WebView instead of actually showing the app.
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Firestore's offline persistence and general app state rely on
        // normal browser storage (IndexedDB/localStorage) being retained
        // between launches, same as it would in a real browser tab.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        // Lets JS alert()/confirm() (used for a few destructive-action
        // confirmations in the app) actually display inside the WebView.
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
