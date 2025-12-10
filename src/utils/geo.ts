export interface Coordinates {
    latitude: number;
    longitude: number;
    accuracy: number;
}

export const getBrowserLocation = (): Promise<Coordinates> => {
    console.log("[Geo] Requesting location...");
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            console.error("[Geo] Geolocation API not supported");
            reject(new Error("Geolocation is not supported by this browser."));
            return;
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log("[Geo] Success:", position.coords);
                console.log("[Geo] Accuracy:", position.coords.accuracy, "meters");
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                console.error("[Geo] Error:", error);
                let errorMsg = "Unknown location error";
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMsg = "User denied the request for Geolocation. Please check browser permissions.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMsg = "Location information is unavailable. Check your network or GPS signal.";
                        break;
                    case error.TIMEOUT:
                        errorMsg = "The request to get user location timed out. Please try again.";
                        break;
                }
                reject(new Error(`${errorMsg} (Code: ${error.code})`));
            },
            options
        );
    });
};
