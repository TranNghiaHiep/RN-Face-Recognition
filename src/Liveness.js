import React, { Component } from "react";
import { Dimensions, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { runOnJS } from 'react-native-reanimated';

import MaskedView from "@react-native-community/masked-view";
import { AnimatedCircularProgress } from "react-native-circular-progress";
import { Camera } from 'react-native-vision-camera';
import { scanFaces, Face } from 'vision-camera-face-detector';
import { useCameraDevices, useFrameProcessor } from 'react-native-vision-camera';

const { width: windowWidth } = Dimensions.get("window");

const PREVIEW_SIZE = 400
const PREVIEW_RECT = {
    minX: (windowWidth - PREVIEW_SIZE) / 2,
    minY: 50,
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE
}

const detections = {
    BLINK: { instruction: "Blink both eyes", minProbability: 0.3 },
    TURN_HEAD_LEFT: { instruction: "Turn head left", maxAngle: -15 },
    TURN_HEAD_RIGHT: { instruction: "Turn head right", minAngle: 15 },
    NOD: { instruction: "Nod", minDiff: 1.5 },
    SMILE: { instruction: "Smile", minProbability: 0.7 }
}

const detectionsList = [
    "BLINK",
    "TURN_HEAD_LEFT",
    "TURN_HEAD_RIGHT",
    "NOD",
    "SMILE"
]

const initialState = {
    faceDetected: "no",
    detectionsList,
    currentDetectionIndex: 0,
    progressFill: 0,
    processComplete: false
}

const detectionReducer = (
    state,
    action
) => {
    switch (action.type) {
        case "FACE_DETECTED":
            if (action.payload === "yes") {
                return {
                    ...state,
                    faceDetected: action.payload,
                    progressFill: 100 / (state.detectionsList.length + 1)
                }
            } else {
                return initialState
            }
        case "NEXT_DETECTION":
            console.log('detectionsList.length', state.detectionsList.length);
            console.log('currentDetectionIndex', state.currentDetectionIndex);
            // next detection index
            const nextDetectionIndex = state.currentDetectionIndex + 1

            // skip 0 index
            const progressMultiplier = nextDetectionIndex + 1
            console.log('progressMultiplier', progressMultiplier);

            const newProgressFill = (100 / (state.detectionsList.length + 1)) * progressMultiplier

            if (nextDetectionIndex === state.detectionsList.length) {
                // success
                console.log('success');
                return {
                    ...state,
                    processComplete: true,
                    progressFill: newProgressFill
                }
            }

            // next
            return {
                ...state,
                currentDetectionIndex: nextDetectionIndex,
                progressFill: newProgressFill
            }
        default:
            throw new Error("Unexpected action type.")
    }
}

export default function Liveness() {
    const [hasPermission, setHasPermission] = React.useState(false);
    const [faces, setFaces] = React.useState([]);

    const [state, dispatch] = React.useReducer(detectionReducer, initialState)
    const rollAngles = React.useRef([])

    const devices = useCameraDevices();
    const device = devices.front;

    React.useEffect(() => {
        console.log(faces);

        if (faces.length !== 1) {
            dispatch({ type: "FACE_DETECTED", payload: "no" })
            return
        }

        if (state.faceDetected === "no") {
            dispatch({ type: "FACE_DETECTED", payload: "yes" })
        }

        const face = faces[0];

        const detectionAction = state.detectionsList[state.currentDetectionIndex]
        console.log('detectionAction', detectionAction);
 
        switch (detectionAction) {
        case "BLINK":
            // Lower probabiltiy is when eyes are closed
            const leftEyeClosed =
            face.leftEyeOpenProbability <= detections.BLINK.minProbability
            const rightEyeClosed =
            face.rightEyeOpenProbability <= detections.BLINK.minProbability
            if (leftEyeClosed && rightEyeClosed) {
                dispatch({ type: "NEXT_DETECTION", payload: null })
            }
            return
        case "NOD":
            // Collect roll angle data
            rollAngles.current.push(face.rollAngle)

            // Don't keep more than 10 roll angles (10 detection frames)
            if (rollAngles.current.length > 10) {
                rollAngles.current.shift()
            }

            // If not enough roll angle data, then don't progress
            if (rollAngles.current.length < 10) return;

            // Calculate avg from collected data, except current angle data
            const rollAnglesExceptCurrent = [...rollAngles.current].splice(0, rollAngles.current.length - 1);

            // Summation
            const rollAnglesSum = rollAnglesExceptCurrent.reduce((prev, curr) => {
                return prev + Math.abs(curr)
            }, 0)

            // Average
            const avgAngle = rollAnglesSum / rollAnglesExceptCurrent.length

            // If the difference between the current angle and the average is above threshold, pass.
            const diff = Math.abs(avgAngle - Math.abs(face.rollAngle))

            if (diff >= detections.NOD.minDiff) {
                dispatch({ type: "NEXT_DETECTION", payload: null });
            }
            return
        case "TURN_HEAD_LEFT":
            // Negative angle is the when the face turns left
            if (face.yawAngle <= detections.TURN_HEAD_LEFT.maxAngle) {
                dispatch({ type: "NEXT_DETECTION", payload: null });
            }
            return
        case "TURN_HEAD_RIGHT":
            // Positive angle is the when the face turns right
            if (face.yawAngle >= detections.TURN_HEAD_RIGHT.minAngle) {
                dispatch({ type: "NEXT_DETECTION", payload: null });
            }
            return
        case "SMILE":
            // Higher probabiltiy is when smiling
            if (face.smilingProbability >= detections.SMILE.minProbability) {
                dispatch({ type: "NEXT_DETECTION", payload: null });
            }
            return
        }

    }, [faces]);

    React.useEffect(() => {
        (async () => {
          const status = await Camera.requestCameraPermission();
          setHasPermission(status === 'authorized');
        })();
    }, []);

    React.useEffect(() => {
        if (state.processComplete) {
            setTimeout(() => {
                // enough delay for the final progress fill animation.
                console.log('processComplete');
            }, 500)
        }
    }, [state.processComplete])
    
    const frameProcessor = useFrameProcessor(frame => {
        'worklet';
        const scannedFaces = scanFaces(frame);
        runOnJS(setFaces)(scannedFaces);
    }, []);

    return device !== null && hasPermission && (
        <SafeAreaView style={StyleSheet.absoluteFill}>
            <MaskedView
                style={StyleSheet.absoluteFill}
                maskElement={<View style={styles.mask} />}
            >
                <Camera
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={true}
                    frameProcessor={frameProcessor}
                    frameProcessorFps={5}
                >
                    <AnimatedCircularProgress
                        style={styles.circularProgress}
                        size={PREVIEW_SIZE}
                        width={5}
                        backgroundWidth={7}
                        fill={state.progressFill}
                        tintColor="#3485FF"
                        backgroundColor="#e8e8e8"
                    />
                </Camera>
            </MaskedView>
            <View style={styles.instructionsContainer}>
                <Text style={styles.instructions}>
                    {state.processComplete && "PASS"}
                </Text>
                <Text style={styles.action}>
                    {state.faceDetected === "yes" &&
                    detections[state.detectionsList[state.currentDetectionIndex]].instruction}
                </Text>
            </View>
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    mask: {
        borderRadius: PREVIEW_SIZE / 2,
        height: PREVIEW_SIZE,
        width: PREVIEW_SIZE,
        marginTop: PREVIEW_RECT.minY,
        alignSelf: "center",
        backgroundColor: "white"
    },
    circularProgress: {
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        marginTop: PREVIEW_RECT.minY,
        marginLeft: PREVIEW_RECT.minX
    },
    instructions: {
        fontSize: 20,
        textAlign: "center",
        top: 25,
        position: "absolute"
    },
    instructionsContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        marginTop: PREVIEW_RECT.minY + PREVIEW_SIZE
    },
    action: {
        fontSize: 24,
        textAlign: "center",
        fontWeight: "bold"
    }
})