# VOZUAL Hand Pose Reference

Run `npm run pose:reference` from `mobile/`, or open `desktop/macos/VOZUALHandPoseReference.command` on macOS.

The local page uses the mobile avatar runtime and a frozen frame from the local DIEZ draft. The larger square has two modes: rotate the hand at the wrist through ±90 degrees on both axes, or use the full square to move the wrist endpoint through the available position range relative to the elbow. In arm mode, the runtime resolves the forearm again to keep it connected; the elbow slider also rotates that segment around the elbow. Other sliders control wrist roll, forearm roll, and palm roll. The fist control applies the runtime's natural fist pose. Copying the description puts the selected angles and position on the clipboard so they can be shared with a screenshot.

The page writes only temporary preview assets under the repository's ignored `tmp/vozual_creator_previews/` directory. It does not edit sign motion JSON, save authoring corrections, or publish to Firebase. The Creator page also has a link to open this reference on the Creator server.
