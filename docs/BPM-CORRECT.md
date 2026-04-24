# BPM 'Octave' Correction

It is common is BPM estimation techniques to have 'octave' errors, where instead of estimating BPM, the estimation is BPM/2 or 2*BPM etc.

In our case, with our estimation of T, the period of the ACF, we can actually estimate N*T, where N = 1, 2, 3, 4, 5, 6, 8 or 10.
These are actually octaves of periodicity of fours: 1, 2, 4 and 8.
Octaves of periodicity of sixes: 3 and 6.
And octaves of periodicity of tens: 5 and 10.

Subharmonic Summation was used to great effect to estimate N*T, the main things making it work well were concavity detection, peak gating, and trough penalising.

We have therefore started using it to also detect octave errors for periodicities of fours by testing the shsScore for bestT/2 and bestT/4 which allows us to detect N = 1, 2 and 4.

We now need to extend it to detect N = 8, 3, 6, 5 and 10.

## Algorithm Proposal

I propose the following algorithm which aims to do the least amount of SHS computation.

div = 1;
periodicity = 4;
if ( shs /2 ) {
    if ( shs / 4) {
        if ( shs /8 ) {
            div = 8;
            periodicity = 4;
        } else {
            div = 4;
            periodicity = 4;
        }
    } else if ( shs /6 ) {
        div = 6;
        periodicity = 6;
    } else if ( shs /10 ) {
        div = 10;
        periodicity = 10;
    } else {
        div = 2;
        periodicity = 4;
    }
} else if ( shs /3 ) {
    div = 3;
    periodicity = 6;
} else if ( shs /5 ) {
    div = 5;
    periodicity = 10;
} else {
    // fallback check in case odd peaks were fully split and fully formed so N=1
    if (fullSupport(6 * bestT) > fullSupport(4 * bestT)) periodicity = 6;
}

bestT /= div;

where 'shs /D' is something like 'shsScore(bestT / D, 0.25) > threshold'
and where threshold is 0.45 from current experience.
Where fullSupport has been modified to remove the s.w4Weight line;

BPM is then derived from peaks[periodicity] or from lag = periodicity * bestT.

## Possible Benefits

Not only will we not consume the peaks array but we may not even need to create it, the whole point of the BPM estimator is to estimate BPM and if we can immediately derive it using this method a whole lot of subdivision support processing may not be required.
Additionally a whole load of peaks and troughs array creation may not be required.
No complicated weighting changes for either side of 100 BPM because no scoring required.
The Locked state wouldn't need to check for better scores because there are no scores.
The Locked state wouldn't need to correct half BPM errors because they wouldn't occur.
There may be a lot less code for better functionality.

## Risks

If we can't eradicate octave errors in T, the estimated BPM will have octave errors.
We may still need to correct octave errors if thresholds aren't ideal.
Completely missing 'odd-numbered peaks' may cause an octave error without other implicit structural analysis support.
There are so many SHS scores on different decision branches it may be difficult to debug or set optimal thresholds on.
The proposed algorithm may be flawed.
The proposed algorithm may not be optimal.

## Counter Arguments

Estimation already suffers BPM octave errors.
Correcting octave errors should be simpler with ideal peak indexing,
The current scoring and weighting system is not exactly simple to work with.
tempo-worker.js is by far the largest source file.
