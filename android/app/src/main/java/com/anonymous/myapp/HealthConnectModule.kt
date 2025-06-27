package com.yourapp

import android.content.Context
import com.facebook.react.bridge.*
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateRecordsRequest
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.permission.Permission

class HealthConnectModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "HealthConnectModule"

    @ReactMethod
    fun getHealthData(promise: Promise) {
        val context: Context = reactApplicationContext
        val client = HealthConnectClient.getOrCreate(context)

        val permissions = setOf(
            Permission.readRecords(StepsRecord::class)
        )

        val now = System.currentTimeMillis()
        val startTime = now - 7 * 24 * 60 * 60 * 1000 // 7 days ago

        val request = AggregateRecordsRequest(
            metrics = setOf(StepsRecord.COUNT_TOTAL),
            timeRangeFilter = TimeRangeFilter.between(
                Instant.ofEpochMilli(startTime),
                Instant.ofEpochMilli(now)
            )
        )

        // Coroutine block
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(permissions)) {
                    promise.reject("PERMISSION_DENIED", "Health Connect permission not granted")
                    return@launch
                }

                val result = client.aggregate(request)
                val steps = result[StepsRecord.COUNT_TOTAL] ?: 0
                val map = Arguments.createMap()
                map.putInt("steps", steps.toInt())
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("Error", e)
            }
        }
    }

    @ReactMethod
    fun openHealthConnectSettings() {
        val context = reactApplicationContext
        val intent = Intent("androidx.health.ACTION_SHOW_HEALTH_CONNECT_SETTINGS")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) // Required when launching from non-activity context
        context.startActivity(intent)
    }

}
